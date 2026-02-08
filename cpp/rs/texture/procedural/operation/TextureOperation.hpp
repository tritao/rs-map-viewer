#pragma once

#include <cstddef>

#include "../../../core/Allocator.hpp"
#include "../../../core/Result.hpp"
#include "../../../core/Span.hpp"
#include "../../../core/Status.hpp"
#include "../../../core/Vec.hpp"
#include "../../../io/Uint8ArrayReader.hpp"
#include "../../../types.hpp"
#include "../TextureGenerator.hpp"
#include "../cache/ColourImageCache.hpp"
#include "../cache/MonochromeImageCache.hpp"

namespace rs {

class TextureOperation {
public:
    virtual ~TextureOperation() {
        releaseOwnedAllocs();
    }

    [[nodiscard]] i32 operationId() const noexcept { return operationId_; }
    [[nodiscard]] u8 cacheSlotCount() const noexcept { return cacheSlotCount_; }
    [[nodiscard]] bool isMonochrome() const noexcept { return isMonochrome_; }
    [[nodiscard]] i32 inputCount() const noexcept { return inputCount_; }
    [[nodiscard]] Span<TextureOperation* const> inputs() const noexcept {
        return Span<TextureOperation* const>(inputs_, static_cast<std::size_t>(inputCount_ < 0 ? 0 : inputCount_));
    }

    // Always destroy via this entrypoint (not `delete`) so derived destructors run and memory is freed via Allocator.
    virtual void destroy(Allocator& alloc) noexcept = 0;

    void setHeader(i32 operationId, u8 cacheSlotCount) noexcept {
        operationId_ = operationId;
        cacheSlotCount_ = cacheSlotCount;
    }

    void setInputs(TextureOperation** inputs, i32 inputCount) noexcept {
        inputs_ = inputs;
        inputCount_ = inputCount;
    }

    // Adoption/alloc helpers: prefer these in decode() implementations so partially-decoded ops
    // can't leak if init/decode fails and the factory destroys the op.
    Status adoptOwnedAlloc(void* ptr, std::size_t align, Allocator& alloc) noexcept {
        if (!ptr || align == 0) {
            return Status::InvalidArgument;
        }
        if (!ownedAllocAllocator_) {
            ownedAllocAllocator_ = &alloc;
            ownedAllocs_ = Vec<OwnedAlloc>(alloc);
        } else if (ownedAllocAllocator_ != &alloc) {
            return Status::InvalidArgument;
        }
        auto pr = ownedAllocs_.pushBack(OwnedAlloc{ptr, align});
        if (!pr.isOk()) {
            return pr.status();
        }
        return Status::Ok;
    }

    template <typename T>
    Result<T*> tryAllocOwnedArray(std::size_t count, Allocator& alloc) noexcept {
        if (count == 0) {
            return Result<T*>::ok(nullptr);
        }
        constexpr std::size_t align = alignof(T);
        const std::size_t bytes = count * sizeof(T);
        void* mem = alloc.alloc(alloc.ctx, bytes, align);
        if (!mem) {
            return Result<T*>::err(Status::OutOfMemory);
        }
        const Status s = adoptOwnedAlloc(mem, align, alloc);
        if (!ok(s)) {
            alloc.free(alloc.ctx, mem, align);
            return Result<T*>::err(s);
        }
        return Result<T*>::ok(static_cast<T*>(mem));
    }

    virtual Status initCaches(TextureGenerator& textureGenerator, i32 width, i32 height, Allocator& alloc) noexcept {
        const i32 slotCount = (cacheSlotCount_ == 0xFF) ? height : static_cast<i32>(cacheSlotCount_);
        if (slotCount <= 0) {
            return Status::InvalidArgument;
        }
        if (isMonochrome_) {
            return monochromeCache_.init(slotCount, height, width, alloc);
        }
        return colourCache_.init(slotCount, height, width, alloc);
    }

    virtual void clearCaches() noexcept {
        monochromeCache_.reset();
        colourCache_.reset();
    }

    // Stronger than clearCaches(): also releases capacity.
    void releaseCaches() noexcept {
        monochromeCache_.releaseMemory();
        colourCache_.releaseMemory();
    }

    virtual Status decode(u8 fieldId, Uint8ArrayReader& reader, Allocator& alloc) noexcept {
        (void)fieldId;
        (void)reader;
        (void)alloc;
        return Status::Ok;
    }

    virtual Status init() noexcept { return Status::Ok; }

    [[nodiscard]] virtual i32 getSpriteId() const noexcept { return -1; }
    [[nodiscard]] virtual i32 getTextureId() const noexcept { return -1; }

    virtual Status getMonochromeOutput(TextureGenerator& textureGenerator, i32 line, Span<i32>* out) noexcept {
        (void)textureGenerator;
        (void)line;
        if (out) {
            *out = Span<i32>(nullptr, 0);
        }
        return Status::Unsupported;
    }

    virtual Status getColourOutput(TextureGenerator& textureGenerator, i32 line, ColourLine* out) noexcept {
        (void)textureGenerator;
        (void)line;
        if (out) {
            *out = ColourLine{};
        }
        return Status::Unsupported;
    }

protected:
    TextureOperation(i32 inputCount, bool isMonochrome) noexcept : isMonochrome_(isMonochrome), inputCount_(inputCount) {}

    void setIsMonochrome(bool v) noexcept { isMonochrome_ = v; }

    Status getMonochromeInput(TextureGenerator& textureGenerator, i32 inputIndex, i32 line, Span<i32>* out) noexcept {
        if (!out) {
            return Status::InvalidArgument;
        }
        *out = Span<i32>(nullptr, 0);
        if (!inputs_ || inputIndex < 0 || inputIndex >= inputCount_) {
            return Status::OutOfRange;
        }
        TextureOperation* op = inputs_[static_cast<std::size_t>(inputIndex)];
        if (!op) {
            return Status::BadFormat;
        }
        if (op->isMonochrome()) {
            return op->getMonochromeOutput(textureGenerator, line, out);
        }
        ColourLine c{};
        const Status s = op->getColourOutput(textureGenerator, line, &c);
        if (!ok(s)) {
            return s;
        }
        *out = c.r;
        return Status::Ok;
    }

    Status getColourInput(TextureGenerator& textureGenerator, i32 inputIndex, i32 line, ColourLine* out) noexcept {
        if (!out) {
            return Status::InvalidArgument;
        }
        *out = ColourLine{};
        if (!inputs_ || inputIndex < 0 || inputIndex >= inputCount_) {
            return Status::OutOfRange;
        }
        TextureOperation* op = inputs_[static_cast<std::size_t>(inputIndex)];
        if (!op) {
            return Status::BadFormat;
        }
        if (!op->isMonochrome()) {
            return op->getColourOutput(textureGenerator, line, out);
        }
        Span<i32> mono;
        const Status s = op->getMonochromeOutput(textureGenerator, line, &mono);
        if (!ok(s)) {
            return s;
        }
        out->r = mono;
        out->g = mono;
        out->b = mono;
        return Status::Ok;
    }

    [[nodiscard]] MonochromeImageCache& monochromeCache() noexcept { return monochromeCache_; }
    [[nodiscard]] ColourImageCache& colourCache() noexcept { return colourCache_; }

private:
    struct OwnedAlloc final {
        void* ptr = nullptr;
        std::size_t align = 0;
    };

    void releaseOwnedAllocs() noexcept {
        if (!ownedAllocAllocator_) {
            ownedAllocs_.clear();
            return;
        }
        for (std::size_t i = 0; i < ownedAllocs_.size(); i++) {
            OwnedAlloc& a = ownedAllocs_[i];
            if (!a.ptr) {
                continue;
            }
            ownedAllocAllocator_->free(ownedAllocAllocator_->ctx, a.ptr, a.align);
            a.ptr = nullptr;
            a.align = 0;
        }
        ownedAllocAllocator_ = nullptr;
        ownedAllocs_.clear();
    }

    i32 operationId_ = -1;
    u8 cacheSlotCount_ = 0;
    bool isMonochrome_ = false;

    TextureOperation** inputs_ = nullptr;
    i32 inputCount_ = 0;

    MonochromeImageCache monochromeCache_{};
    ColourImageCache colourCache_{};

    Allocator* ownedAllocAllocator_ = nullptr;
    Vec<OwnedAlloc> ownedAllocs_{};
};

template <typename Derived>
class TextureOperationImpl : public TextureOperation {
public:
    void destroy(Allocator& alloc) noexcept final {
        static_cast<Derived*>(this)->~Derived();
        alloc.free(alloc.ctx, this, alignof(Derived));
    }

protected:
    TextureOperationImpl(i32 inputCount, bool isMonochrome) noexcept : TextureOperation(inputCount, isMonochrome) {}
};

} // namespace rs
