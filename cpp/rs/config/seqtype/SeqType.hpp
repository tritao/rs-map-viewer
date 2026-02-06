#pragma once

#include "../../cache/CacheInfo.hpp"
#include "../../core/Status.hpp"
#include "../../core/Vec.hpp"
#include "../../io/Uint8ArrayReader.hpp"
#include "../../types.hpp"
#include "../TypeDecode.hpp"

namespace rs {

struct SeqSoundEffect {
    i32 id = 0;
    i32 loops = 0;
    i32 location = 0;
    i32 retain = 0;
};

struct SeqSoundVolumeByIndex {
    i32 index = 0;
    i32 volume = 0;
};

struct SeqSoundRateByIndex {
    i32 index = 0;
    i32 rateMin = 0;
    i32 rateMax = 0;
};

struct SeqMayaFrameSound {
    i32 frame = 0;
    SeqSoundEffect effect{};
};

struct SeqType {
    i32 id = -1;
    CacheInfo cacheInfo{};

    Vec<i32> frameIds{};
    Vec<i32> frameLengths{};
    Vec<i32> chatFrameIds{};
    Vec<i32> masks{};
    Vec<SeqSoundEffect> frameSounds{};

    i32 frameStep = -1;
    bool stretches = false;
    i32 forcedPriority = 5;
    i32 leftHandItem = -1;
    i32 rightHandItem = -1;
    i32 maxLoops = 99;
    bool looping = false;
    i32 precedenceAnimating = -1;
    i32 priority = -1;
    i32 replayMode = 2;
    bool tweened = false;
    bool vorbisSound = false;

    // Oldschool "anim maya"
    i32 animMayaId = -1;
    i32 animMayaStart = 0;
    i32 animMayaEnd = 0;
    bool animMayaMasks[256]{};
    bool hasAnimMayaMasks = false;
    Vec<SeqMayaFrameSound> animMayaFrameSounds{};

    bool rotateNormals = false;

    // Optional sound tuning (ported as arrays of pairs to keep STL-free).
    Vec<SeqSoundVolumeByIndex> soundVolumesByIndex{};
    Vec<SeqSoundRateByIndex> soundRatesByIndex{};

    SeqType() = default;
    SeqType(i32 id_, const CacheInfo& cacheInfo_) noexcept : id(id_), cacheInfo(cacheInfo_) {}

    [[nodiscard]] bool isNewSoundEffects() const noexcept {
        return cacheInfo.game == GameType::Oldschool && cacheInfo.revision >= 220;
    }

    Status decodeOpcode(u8 opcode, Uint8ArrayReader& reader, const TypeDecodeContext& ctx) noexcept {
        if (!ctx.alloc) {
            return Status::InvalidArgument;
        }

        if (opcode == 1) {
            i32 count = 0;
            if (cacheInfo.game == GameType::Runescape && cacheInfo.revision < 456) {
                u8 c = 0;
                const Status s = reader.readUnsignedByte(&c);
                if (!ok(s)) {
                    return s;
                }
                count = static_cast<i32>(c);
            } else {
                u16 c = 0;
                const Status s = reader.readUnsignedShort(&c);
                if (!ok(s)) {
                    return s;
                }
                count = static_cast<i32>(c);
            }

            if (count < 0) {
                return Status::BadFormat;
            }
            const std::size_t n = static_cast<std::size_t>(count);

            Vec<i32> outFrameIds(*ctx.alloc);
            Vec<i32> outFrameLengths(*ctx.alloc);
            auto rr = outFrameIds.resize(n);
            if (!rr.isOk()) {
                return rr.status();
            }
            rr = outFrameLengths.resize(n);
            if (!rr.isOk()) {
                return rr.status();
            }

            if (cacheInfo.game == GameType::Runescape && cacheInfo.revision <= 377) {
                for (std::size_t i = 0; i < n; i++) {
                    u16 frameId = 0;
                    u16 unused = 0;
                    u16 len = 0;
                    Status s = reader.readUnsignedShort(&frameId);
                    if (!ok(s)) {
                        return s;
                    }
                    s = reader.readUnsignedShort(&unused);
                    if (!ok(s)) {
                        return s;
                    }
                    s = reader.readUnsignedShort(&len);
                    if (!ok(s)) {
                        return s;
                    }
                    outFrameIds[i] = static_cast<i32>(frameId);
                    outFrameLengths[i] = static_cast<i32>(len);
                }
            } else {
                for (std::size_t i = 0; i < n; i++) {
                    u16 len = 0;
                    const Status s = reader.readUnsignedShort(&len);
                    if (!ok(s)) {
                        return s;
                    }
                    outFrameLengths[i] = static_cast<i32>(len);
                }
                for (std::size_t i = 0; i < n; i++) {
                    u16 low = 0;
                    const Status s = reader.readUnsignedShort(&low);
                    if (!ok(s)) {
                        return s;
                    }
                    outFrameIds[i] = static_cast<i32>(low);
                }
                for (std::size_t i = 0; i < n; i++) {
                    u16 high = 0;
                    const Status s = reader.readUnsignedShort(&high);
                    if (!ok(s)) {
                        return s;
                    }
                    outFrameIds[i] = outFrameIds[i] + (static_cast<i32>(high) << 16);
                }
            }

            frameIds = rs::move(outFrameIds);
            frameLengths = rs::move(outFrameLengths);
            return Status::Ok;
        }

        if (opcode == 2) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            frameStep = static_cast<i32>(v);
            return Status::Ok;
        }

        if (opcode == 3) {
            u8 countU8 = 0;
            Status s = reader.readUnsignedByte(&countU8);
            if (!ok(s)) {
                return s;
            }
            const std::size_t count = static_cast<std::size_t>(countU8);

            Vec<i32> out(*ctx.alloc);
            auto rr = out.resize(count + 1);
            if (!rr.isOk()) {
                return rr.status();
            }
            for (std::size_t i = 0; i < count; i++) {
                u8 v = 0;
                s = reader.readUnsignedByte(&v);
                if (!ok(s)) {
                    return s;
                }
                out[i] = static_cast<i32>(v);
            }
            out[count] = 9999999;
            masks = rs::move(out);
            return Status::Ok;
        }

        if (opcode == 4) {
            if (cacheInfo.game == GameType::Runescape && cacheInfo.revision <= 194) {
                u16 v = 0;
                const Status s = reader.readUnsignedShort(&v);
                if (!ok(s)) {
                    return s;
                }
                stretches = (v == 1);
            } else {
                stretches = true;
            }
            return Status::Ok;
        }

        if (opcode == 5) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            forcedPriority = static_cast<i32>(v);
            return Status::Ok;
        }

        if (opcode == 6) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            leftHandItem = static_cast<i32>(v);
            return Status::Ok;
        }

        if (opcode == 7) {
            u16 v = 0;
            const Status s = reader.readUnsignedShort(&v);
            if (!ok(s)) {
                return s;
            }
            rightHandItem = static_cast<i32>(v);
            return Status::Ok;
        }

        if (opcode == 8) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            maxLoops = static_cast<i32>(v);
            looping = true;
            return Status::Ok;
        }

        if (opcode == 9) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            precedenceAnimating = static_cast<i32>(v);
            return Status::Ok;
        }

        if (opcode == 10) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            priority = static_cast<i32>(v);
            return Status::Ok;
        }

        if (opcode == 11) {
            u8 v = 0;
            const Status s = reader.readUnsignedByte(&v);
            if (!ok(s)) {
                return s;
            }
            replayMode = static_cast<i32>(v);
            return Status::Ok;
        }

        if (opcode == 12) {
            if (cacheInfo.game == GameType::Runescape && cacheInfo.revision <= 377) {
                i32 unused = 0;
                return reader.readInt(&unused);
            }
            u8 countU8 = 0;
            Status s = reader.readUnsignedByte(&countU8);
            if (!ok(s)) {
                return s;
            }
            const std::size_t count = static_cast<std::size_t>(countU8);

            Vec<i32> out(*ctx.alloc);
            auto rr = out.resize(count);
            if (!rr.isOk()) {
                return rr.status();
            }
            for (std::size_t i = 0; i < count; i++) {
                u16 low = 0;
                s = reader.readUnsignedShort(&low);
                if (!ok(s)) {
                    return s;
                }
                out[i] = static_cast<i32>(low);
            }
            for (std::size_t i = 0; i < count; i++) {
                u16 high = 0;
                s = reader.readUnsignedShort(&high);
                if (!ok(s)) {
                    return s;
                }
                out[i] = out[i] + (static_cast<i32>(high) << 16);
            }
            chatFrameIds = rs::move(out);
            return Status::Ok;
        }

        if (opcode == 13) {
            // Revision-dependent opcode.
            if (cacheInfo.game == GameType::Runescape && cacheInfo.revision >= 508) {
                u16 count = 0;
                Status s = reader.readUnsignedShort(&count);
                if (!ok(s)) {
                    return s;
                }
                for (u16 i = 0; i < count; i++) {
                    u8 effectCount = 0;
                    s = reader.readUnsignedByte(&effectCount);
                    if (!ok(s)) {
                        return s;
                    }
                    if (effectCount > 0) {
                        // skip medium + (effectCount-1)*u16
                        u32 unused = 0;
                        s = reader.readMedium(&unused);
                        if (!ok(s)) {
                            return s;
                        }
                        for (u8 e = 1; e < effectCount; e++) {
                            u16 u = 0;
                            s = reader.readUnsignedShort(&u);
                            if (!ok(s)) {
                                return s;
                            }
                        }
                    }
                }
                return Status::Ok;
            }

            u8 countU8 = 0;
            Status s = reader.readUnsignedByte(&countU8);
            if (!ok(s)) {
                return s;
            }
            const std::size_t count = static_cast<std::size_t>(countU8);

            Vec<SeqSoundEffect> out(*ctx.alloc);
            auto rr = out.resize(count);
            if (!rr.isOk()) {
                return rr.status();
            }

            const bool newSound = isNewSoundEffects();
            for (std::size_t i = 0; i < count; i++) {
                SeqSoundEffect eff{};
                if (newSound) {
                    u16 idU16 = 0;
                    u8 loopsU8 = 0;
                    u8 locU8 = 0;
                    u8 retainU8 = 0;
                    s = reader.readUnsignedShort(&idU16);
                    if (!ok(s)) {
                        return s;
                    }
                    s = reader.readUnsignedByte(&loopsU8);
                    if (!ok(s)) {
                        return s;
                    }
                    s = reader.readUnsignedByte(&locU8);
                    if (!ok(s)) {
                        return s;
                    }
                    s = reader.readUnsignedByte(&retainU8);
                    if (!ok(s)) {
                        return s;
                    }
                    eff.id = static_cast<i32>(idU16);
                    eff.loops = static_cast<i32>(loopsU8);
                    eff.location = static_cast<i32>(locU8);
                    eff.retain = static_cast<i32>(retainU8);
                } else {
                    u32 sound = 0;
                    s = reader.readMedium(&sound);
                    if (!ok(s)) {
                        return s;
                    }
                    eff.id = static_cast<i32>(sound >> 8);
                    eff.loops = static_cast<i32>((sound >> 4) & 0x7);
                    eff.location = static_cast<i32>(sound & 0xF);
                    eff.retain = 0;
                }
                out[i] = eff;
            }

            frameSounds = rs::move(out);
            return Status::Ok;
        }

        if (opcode == 14) {
            if (cacheInfo.game == GameType::Oldschool) {
                i32 v = 0;
                const Status s = reader.readInt(&v);
                if (!ok(s)) {
                    return s;
                }
                animMayaId = v;
                return Status::Ok;
            }
            rotateNormals = true;
            return Status::Ok;
        }

        if (opcode == 15) {
            if (cacheInfo.game != GameType::Oldschool) {
                tweened = true;
                return Status::Ok;
            }

            u16 countU16 = 0;
            Status s = reader.readUnsignedShort(&countU16);
            if (!ok(s)) {
                return s;
            }
            const std::size_t count = static_cast<std::size_t>(countU16);

            Vec<SeqMayaFrameSound> out(*ctx.alloc);
            auto rr = out.resize(count);
            if (!rr.isOk()) {
                return rr.status();
            }

            const bool newSound = isNewSoundEffects();
            for (std::size_t i = 0; i < count; i++) {
                u16 frameU16 = 0;
                s = reader.readUnsignedShort(&frameU16);
                if (!ok(s)) {
                    return s;
                }

                SeqSoundEffect eff{};
                if (newSound) {
                    u16 idU16 = 0;
                    u8 loopsU8 = 0;
                    u8 locU8 = 0;
                    u8 retainU8 = 0;
                    s = reader.readUnsignedShort(&idU16);
                    if (!ok(s)) {
                        return s;
                    }
                    s = reader.readUnsignedByte(&loopsU8);
                    if (!ok(s)) {
                        return s;
                    }
                    s = reader.readUnsignedByte(&locU8);
                    if (!ok(s)) {
                        return s;
                    }
                    s = reader.readUnsignedByte(&retainU8);
                    if (!ok(s)) {
                        return s;
                    }
                    eff.id = static_cast<i32>(idU16);
                    eff.loops = static_cast<i32>(loopsU8);
                    eff.location = static_cast<i32>(locU8);
                    eff.retain = static_cast<i32>(retainU8);
                } else {
                    u32 sound = 0;
                    s = reader.readMedium(&sound);
                    if (!ok(s)) {
                        return s;
                    }
                    eff.id = static_cast<i32>(sound >> 8);
                    eff.loops = static_cast<i32>((sound >> 4) & 0x7);
                    eff.location = static_cast<i32>(sound & 0xF);
                    eff.retain = 0;
                }

                SeqMayaFrameSound m{};
                m.frame = static_cast<i32>(frameU16);
                m.effect = eff;
                out[i] = m;
            }

            animMayaFrameSounds = rs::move(out);
            return Status::Ok;
        }

        if (opcode == 16) {
            if (cacheInfo.game != GameType::Oldschool) {
                return Status::Ok;
            }
            u16 start = 0;
            u16 end = 0;
            Status s = reader.readUnsignedShort(&start);
            if (!ok(s)) {
                return s;
            }
            s = reader.readUnsignedShort(&end);
            if (!ok(s)) {
                return s;
            }
            animMayaStart = static_cast<i32>(start);
            animMayaEnd = static_cast<i32>(end);
            return Status::Ok;
        }

        if (opcode == 17) {
            if (cacheInfo.game != GameType::Oldschool) {
                u8 blendFlagCount = 0;
                return reader.readUnsignedByte(&blendFlagCount);
            }
            u8 countU8 = 0;
            Status s = reader.readUnsignedByte(&countU8);
            if (!ok(s)) {
                return s;
            }
            for (i32 i = 0; i < 256; i++) {
                animMayaMasks[i] = false;
            }
            hasAnimMayaMasks = true;
            for (u8 i = 0; i < countU8; i++) {
                u8 idx = 0;
                s = reader.readUnsignedByte(&idx);
                if (!ok(s)) {
                    return s;
                }
                animMayaMasks[idx] = true;
            }
            return Status::Ok;
        }

        if (opcode == 18) {
            vorbisSound = true;
            return Status::Ok;
        }

        if (opcode == 19) {
            u8 idx = 0;
            u8 vol = 0;
            Status s = reader.readUnsignedByte(&idx);
            if (!ok(s)) {
                return s;
            }
            s = reader.readUnsignedByte(&vol);
            if (!ok(s)) {
                return s;
            }

            SeqSoundVolumeByIndex entry{};
            entry.index = static_cast<i32>(idx);
            entry.volume = static_cast<i32>(vol);

            auto rr = soundVolumesByIndex.pushBack(entry);
            if (!rr.isOk()) {
                return rr.status();
            }
            return Status::Ok;
        }

        if (opcode == 20) {
            u8 idx = 0;
            u16 rMin = 0;
            u16 rMax = 0;
            Status s = reader.readUnsignedByte(&idx);
            if (!ok(s)) {
                return s;
            }
            s = reader.readUnsignedShort(&rMin);
            if (!ok(s)) {
                return s;
            }
            s = reader.readUnsignedShort(&rMax);
            if (!ok(s)) {
                return s;
            }

            SeqSoundRateByIndex entry{};
            entry.index = static_cast<i32>(idx);
            entry.rateMin = static_cast<i32>(rMin);
            entry.rateMax = static_cast<i32>(rMax);

            auto rr = soundRatesByIndex.pushBack(entry);
            if (!rr.isOk()) {
                return rr.status();
            }
            return Status::Ok;
        }

        return Status::Unsupported;
    }
};

} // namespace rs

