#pragma once

#include "../../io/ByteSource.hpp"
#include "../../core/Status.hpp"
#include "../../core/Vec.hpp"

namespace rs {

class CacheStore {
public:
    virtual ~CacheStore() = default;

    virtual Status getIndexFileSize(i32 indexId, std::size_t* outSize) const noexcept = 0;

    // Reads the raw archive bytes (container/packed format as stored on disk) into `out`.
    virtual Status readArchive(i32 indexId, i32 archiveId, Vec<u8>* out) const noexcept = 0;
};

} // namespace rs
