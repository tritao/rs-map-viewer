#pragma once

#include "../../cache/format/Archive.hpp"
#include "../../core/Allocator.hpp"
#include "../../core/Move.hpp"
#include "../../core/Result.hpp"
#include "../../core/Status.hpp"
#include "../../core/Vec.hpp"
#include "../../io/Uint8ArrayReader.hpp"
#include "../../types.hpp"
#include "../../util/StringHash.hpp"
#include "SeqBaseLoader.hpp"
#include "SeqFrameLoaderCommon.hpp"

namespace rs {

class LegacySeqFrameLoader final {
public:
    LegacySeqFrameLoader() noexcept
        : alloc_(&defaultAllocator()),
          bases_(defaultAllocator()),
          hasBase_(defaultAllocator()),
          frames_(defaultAllocator()),
          hasFrame_(defaultAllocator()),
          statusById_(defaultAllocator()) {}

    [[nodiscard]] i32 getCount() const noexcept { return count_; }

    static Result<LegacySeqFrameLoader> create(const Archive& modelArchive, Allocator& alloc = defaultAllocator()) noexcept {
        LegacySeqFrameLoader out;
        out.alloc_ = &alloc;
        out.bases_ = Vec<SeqBase>(alloc);
        out.hasBase_ = Vec<u8>(alloc);
        out.frames_ = Vec<SeqFrame>(alloc);
        out.hasFrame_ = Vec<u8>(alloc);
        out.statusById_ = Vec<Status>(alloc);

        Vec<u8> baseHeadBytes(alloc);
        Vec<u8> baseTypeBytes(alloc);
        Vec<u8> baseLabelBytes(alloc);
        Vec<u8> frameHeadBytes(alloc);
        Vec<u8> frameTran1Bytes(alloc);
        Vec<u8> frameTran2Bytes(alloc);
        Vec<u8> frameDelBytes(alloc);

        Status s = copyNamedFile(modelArchive, "base_head.dat", &baseHeadBytes);
        if (!ok(s)) return Result<LegacySeqFrameLoader>::err(s);
        s = copyNamedFile(modelArchive, "base_type.dat", &baseTypeBytes);
        if (!ok(s)) return Result<LegacySeqFrameLoader>::err(s);
        s = copyNamedFile(modelArchive, "base_label.dat", &baseLabelBytes);
        if (!ok(s)) return Result<LegacySeqFrameLoader>::err(s);
        s = copyNamedFile(modelArchive, "frame_head.dat", &frameHeadBytes);
        if (!ok(s)) return Result<LegacySeqFrameLoader>::err(s);
        s = copyNamedFile(modelArchive, "frame_tran1.dat", &frameTran1Bytes);
        if (!ok(s)) return Result<LegacySeqFrameLoader>::err(s);
        s = copyNamedFile(modelArchive, "frame_tran2.dat", &frameTran2Bytes);
        if (!ok(s)) return Result<LegacySeqFrameLoader>::err(s);
        s = copyNamedFile(modelArchive, "frame_del.dat", &frameDelBytes);
        if (!ok(s)) return Result<LegacySeqFrameLoader>::err(s);

        s = out.decodeBases(
            Span<const u8>(baseHeadBytes.data(), baseHeadBytes.size()),
            Span<const u8>(baseTypeBytes.data(), baseTypeBytes.size()),
            Span<const u8>(baseLabelBytes.data(), baseLabelBytes.size()));
        if (!ok(s)) return Result<LegacySeqFrameLoader>::err(s);

        s = out.decodeFrames(
            Span<const u8>(frameHeadBytes.data(), frameHeadBytes.size()),
            Span<const u8>(frameTran1Bytes.data(), frameTran1Bytes.size()),
            Span<const u8>(frameTran2Bytes.data(), frameTran2Bytes.size()),
            Span<const u8>(frameDelBytes.data(), frameDelBytes.size()));
        if (!ok(s)) return Result<LegacySeqFrameLoader>::err(s);

        return Result<LegacySeqFrameLoader>::ok(rs::move(out));
    }

    Status tryLoad(i32 id, SeqFrame* out) const noexcept {
        if (!out) return Status::InvalidArgument;
        if (id < 0) return Status::OutOfRange;

        const std::size_t idx = static_cast<std::size_t>(id);
        if (idx >= hasFrame_.size() || hasFrame_[idx] == 0) {
            return Status::NotFound;
        }

        const Status st = (idx < statusById_.size()) ? statusById_[idx] : Status::NotFound;
        if (!ok(st)) {
            return st;
        }

        return cloneSeqFrame(frames_[idx], *alloc_, out);
    }

    Status tryGet(i32 id, SeqFrame* out) const noexcept {
        return tryLoad(id, out);
    }

    void clearCache() noexcept {}

private:
    static Status copyNamedFile(const Archive& archive, const char* name, Vec<u8>* out) noexcept {
        if (!name || !out) return Status::InvalidArgument;
        const ArchiveFile* f = archive.getFileByNameHash(hashOld(name));
        if (!f) return Status::NotFound;

        auto rr = out->resize(f->data.size());
        if (!rr.isOk()) return rr.status();
        for (std::size_t i = 0; i < f->data.size(); i++) {
            (*out)[i] = f->data[i];
        }
        return Status::Ok;
    }

    Status decodeBases(Span<const u8> headBytes, Span<const u8> typeBytes, Span<const u8> labelBytes) noexcept {
        Uint8ArrayReader head(headBytes, 0);
        Uint8ArrayReader type(typeBytes, 0);
        Uint8ArrayReader label(labelBytes, 0);

        u16 baseCountU16 = 0;
        u16 lastBaseIdU16 = 0;
        Status s = head.readUnsignedShort(&baseCountU16);
        if (!ok(s)) return s;
        s = head.readUnsignedShort(&lastBaseIdU16);
        if (!ok(s)) return s;

        const std::size_t baseCapacity = static_cast<std::size_t>(lastBaseIdU16) + 1;
        auto rr = bases_.resize(baseCapacity);
        if (!rr.isOk()) return rr.status();
        rr = hasBase_.resize(baseCapacity);
        if (!rr.isOk()) return rr.status();
        for (std::size_t i = 0; i < baseCapacity; i++) {
            bases_[i] = SeqBase(-1, *alloc_);
            hasBase_[i] = 0;
        }

        const i32 baseCount = static_cast<i32>(baseCountU16);
        for (i32 i = 0; i < baseCount; i++) {
            u16 baseIdU16 = 0;
            u8 countU8 = 0;
            s = head.readUnsignedShort(&baseIdU16);
            if (!ok(s)) return s;
            s = head.readUnsignedByte(&countU8);
            if (!ok(s)) return s;

            const std::size_t baseId = static_cast<std::size_t>(baseIdU16);
            if (baseId >= bases_.size()) return Status::BadFormat;
            const i32 count = static_cast<i32>(countU8);

            SeqBase base(static_cast<i32>(baseIdU16), *alloc_);
            base.count = count;
            rr = base.types.resize(static_cast<std::size_t>(count));
            if (!rr.isOk()) return rr.status();
            rr = base.transformActor.resize(static_cast<std::size_t>(count));
            if (!rr.isOk()) return rr.status();
            rr = base.masks.resize(static_cast<std::size_t>(count));
            if (!rr.isOk()) return rr.status();
            rr = base.labels.resize(static_cast<std::size_t>(count));
            if (!rr.isOk()) return rr.status();

            for (i32 j = 0; j < count; j++) {
                u8 rawType = 0;
                s = type.readUnsignedByte(&rawType);
                if (!ok(s)) return s;
                base.types[static_cast<std::size_t>(j)] = static_cast<SeqTransformType>(static_cast<i32>(rawType));

                base.transformActor[static_cast<std::size_t>(j)] = 1;
                base.masks[static_cast<std::size_t>(j)] = -1;

                u8 subCountU8 = 0;
                s = label.readUnsignedByte(&subCountU8);
                if (!ok(s)) return s;
                Vec<i32> labels(*alloc_);
                rr = labels.resize(static_cast<std::size_t>(subCountU8));
                if (!rr.isOk()) return rr.status();
                for (std::size_t l = 0; l < labels.size(); l++) {
                    u8 value = 0;
                    s = label.readUnsignedByte(&value);
                    if (!ok(s)) return s;
                    labels[l] = static_cast<i32>(value);
                }
                base.labels[static_cast<std::size_t>(j)] = rs::move(labels);
            }

            bases_[baseId] = rs::move(base);
            hasBase_[baseId] = 1;
        }

        return Status::Ok;
    }

    Status decodeFrames(
        Span<const u8> headBytes,
        Span<const u8> tran1Bytes,
        Span<const u8> tran2Bytes,
        Span<const u8> delBytes) noexcept {
        Uint8ArrayReader head(headBytes, 0);
        Uint8ArrayReader tran1(tran1Bytes, 0);
        Uint8ArrayReader tran2(tran2Bytes, 0);
        Uint8ArrayReader del(delBytes, 0);

        u16 frameCountU16 = 0;
        u16 lastFrameIdU16 = 0;
        Status s = head.readUnsignedShort(&frameCountU16);
        if (!ok(s)) return s;
        s = head.readUnsignedShort(&lastFrameIdU16);
        if (!ok(s)) return s;

        const std::size_t frameCapacity = static_cast<std::size_t>(lastFrameIdU16) + 1;
        auto rr = frames_.resize(frameCapacity);
        if (!rr.isOk()) return rr.status();
        rr = hasFrame_.resize(frameCapacity);
        if (!rr.isOk()) return rr.status();
        rr = statusById_.resize(frameCapacity);
        if (!rr.isOk()) return rr.status();
        for (std::size_t i = 0; i < frameCapacity; i++) {
            frames_[i] = SeqFrame(*alloc_);
            hasFrame_[i] = 0;
            statusById_[i] = Status::NotFound;
        }

        SeqFrameDecodeScratch scratch(*alloc_);

        const i32 frameCount = static_cast<i32>(frameCountU16);
        for (i32 f = 0; f < frameCount; f++) {
            u16 frameIdU16 = 0;
            u16 baseIdU16 = 0;
            u8 frameLengthU8 = 0;
            u8 countU8 = 0;

            s = head.readUnsignedShort(&frameIdU16);
            if (!ok(s)) return s;
            s = del.readUnsignedByte(&frameLengthU8);
            if (!ok(s)) return s;
            s = head.readUnsignedShort(&baseIdU16);
            if (!ok(s)) return s;
            s = head.readUnsignedByte(&countU8);
            if (!ok(s)) return s;

            const std::size_t frameId = static_cast<std::size_t>(frameIdU16);
            const std::size_t baseId = static_cast<std::size_t>(baseIdU16);
            if (frameId >= frames_.size()) return Status::BadFormat;
            if (baseId >= hasBase_.size() || hasBase_[baseId] == 0) return Status::BadFormat;

            const SeqBase& base = bases_[baseId];
            const i32 count = static_cast<i32>(countU8);

            s = scratch.ensureCapacity(static_cast<std::size_t>(count));
            if (!ok(s)) return s;

            i32 transformCount = 0;
            i32 resetOriginGroup = -1;
            i32 lastResetOriginGroup = -1;
            bool hasAlphaTransform = false;

            for (i32 i = 0; i < count; i++) {
                const std::size_t ii = static_cast<std::size_t>(i);
                if (ii >= base.types.size()) return Status::BadFormat;
                const SeqTransformType type = base.types[ii];

                if (type == SeqTransformType::ORIGIN) {
                    resetOriginGroup = i;
                }

                u8 flag = 0;
                s = tran1.readUnsignedByte(&flag);
                if (!ok(s)) return s;
                if (flag == 0) {
                    continue;
                }

                if (type == SeqTransformType::ORIGIN) {
                    lastResetOriginGroup = i;
                }

                const std::size_t ti = static_cast<std::size_t>(transformCount);
                scratch.transformGroupCache[ti] = i;

                i32 defaultValue = (type == SeqTransformType::SCALE) ? 128 : 0;

                if ((flag & 0x1) != 0) {
                    s = tran2.readSmart2(&scratch.transformXCache[ti]);
                    if (!ok(s)) return s;
                } else {
                    scratch.transformXCache[ti] = defaultValue;
                }

                if ((flag & 0x2) != 0) {
                    s = tran2.readSmart2(&scratch.transformYCache[ti]);
                    if (!ok(s)) return s;
                } else {
                    scratch.transformYCache[ti] = defaultValue;
                }

                if ((flag & 0x4) != 0) {
                    s = tran2.readSmart2(&scratch.transformZCache[ti]);
                    if (!ok(s)) return s;
                } else {
                    scratch.transformZCache[ti] = defaultValue;
                }

                scratch.resetOriginGroupsCache[ti] = -1;
                if (type == SeqTransformType::TRANSLATE ||
                    type == SeqTransformType::ROTATE ||
                    type == SeqTransformType::SCALE) {
                    if (resetOriginGroup > lastResetOriginGroup) {
                        scratch.resetOriginGroupsCache[ti] = resetOriginGroup;
                        lastResetOriginGroup = resetOriginGroup;
                    }
                } else if (type == SeqTransformType::ALPHA) {
                    hasAlphaTransform = true;
                }

                transformCount++;
            }

            SeqFrame frame(*alloc_);
            frame.frameLength = static_cast<i32>(frameLengthU8);
            frame.baseId = static_cast<i32>(baseIdU16);
            frame.transformCount = transformCount;
            frame.hasAlphaTransform = hasAlphaTransform;
            frame.hasColorTransform = false;

            rr = frame.transformGroups.resize(static_cast<std::size_t>(transformCount));
            if (!rr.isOk()) return rr.status();
            rr = frame.transformX.resize(static_cast<std::size_t>(transformCount));
            if (!rr.isOk()) return rr.status();
            rr = frame.transformY.resize(static_cast<std::size_t>(transformCount));
            if (!rr.isOk()) return rr.status();
            rr = frame.transformZ.resize(static_cast<std::size_t>(transformCount));
            if (!rr.isOk()) return rr.status();
            rr = frame.resetOriginGroups.resize(static_cast<std::size_t>(transformCount));
            if (!rr.isOk()) return rr.status();

            for (i32 i = 0; i < transformCount; i++) {
                const std::size_t ii = static_cast<std::size_t>(i);
                frame.transformGroups[ii] = scratch.transformGroupCache[ii];
                frame.transformX[ii] = scratch.transformXCache[ii];
                frame.transformY[ii] = scratch.transformYCache[ii];
                frame.transformZ[ii] = scratch.transformZCache[ii];
                frame.resetOriginGroups[ii] = scratch.resetOriginGroupsCache[ii];
            }

            frames_[frameId] = rs::move(frame);
            hasFrame_[frameId] = 1;
            statusById_[frameId] = Status::Ok;
        }

        count_ = static_cast<i32>(frameCount);
        return Status::Ok;
    }

    Allocator* alloc_ = nullptr;
    i32 count_ = 0;
    Vec<SeqBase> bases_{};
    Vec<u8> hasBase_{};
    Vec<SeqFrame> frames_{};
    Vec<u8> hasFrame_{};
    Vec<Status> statusById_{};
};

} // namespace rs

