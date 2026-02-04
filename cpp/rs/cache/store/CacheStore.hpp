#pragma once

#include <optional>

#include "../../io/ByteSource.hpp"

namespace rs {

class CacheStore {
public:
    virtual ~CacheStore() = default;

    [[nodiscard]] virtual std::optional<std::size_t> getIndexFileSize(i32 indexId) const = 0;
    [[nodiscard]] virtual ByteSourcePtr openArchiveReader(i32 indexId, i32 archiveId) const = 0;
};

} // namespace rs

