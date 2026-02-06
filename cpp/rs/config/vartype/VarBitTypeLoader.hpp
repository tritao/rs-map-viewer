#pragma once

#include <cstddef>

#include "../../cache/format/Archive.hpp"
#include "../../cache/format/ArchiveFile.hpp"
#include "../../core/Allocator.hpp"
#include "../../core/Result.hpp"
#include "../../core/Span.hpp"
#include "../../core/Status.hpp"
#include "../../core/Vec.hpp"
#include "../../io/Uint8ArrayReader.hpp"
#include "../../types.hpp"
#include "../TypeDecode.hpp"
#include "VarBitType.hpp"

namespace rs {

class VarBitTypeLoader final {
public:
    static Result<VarBitTypeLoader> fromArchive(const CacheInfo& cacheInfo, const Archive& archive, Allocator& alloc) noexcept;

    VarBitTypeLoader() = default;

    [[nodiscard]] i32 count() const noexcept { return count_; }

    // Returns NotFound when the id is missing.
    Status get(i32 id, const VarBitType** out) const noexcept;

private:
    explicit VarBitTypeLoader(Vec<VarBitType> types, Vec<u8> present, i32 count) noexcept
        : types_(rs::move(types)), present_(rs::move(present)), count_(count) {}

    Vec<VarBitType> types_;
    Vec<u8> present_;
    i32 count_ = 0;
};

} // namespace rs

