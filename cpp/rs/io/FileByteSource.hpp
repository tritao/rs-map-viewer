#pragma once

#include <cstddef>

#include "../core/Result.hpp"
#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "ByteSource.hpp"

namespace rs {

class FileByteSource final : public ByteSource {
public:
    static Result<FileByteSource> open(const char* path) noexcept;

    FileByteSource() = default;
    ~FileByteSource() override;

    FileByteSource(const FileByteSource&) = delete;
    FileByteSource& operator=(const FileByteSource&) = delete;

    FileByteSource(FileByteSource&& other) noexcept;
    FileByteSource& operator=(FileByteSource&& other) noexcept;

    [[nodiscard]] std::size_t size() const noexcept override { return size_; }
    Status readInto(std::size_t offset, Span<u8> target) const noexcept override;
    [[nodiscard]] bool tryGetView(Span<const u8>*) const noexcept override { return false; }

private:
    explicit FileByteSource(int fd, std::size_t size) noexcept : fd_(fd), size_(size) {}

    int fd_ = -1;
    std::size_t size_ = 0;
};

} // namespace rs
