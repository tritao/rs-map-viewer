#pragma once

#include <memory>
#include <optional>
#include <span>
#include <string>

#include "ByteSource.hpp"

namespace rs {

class FileByteSource final : public ByteSource, public std::enable_shared_from_this<FileByteSource> {
public:
    explicit FileByteSource(std::string path);
    ~FileByteSource() override;

    FileByteSource(const FileByteSource&) = delete;
    FileByteSource& operator=(const FileByteSource&) = delete;

    [[nodiscard]] std::size_t size() const override { return size_; }
    [[nodiscard]] ByteSourcePtr slice(std::size_t start, std::size_t size) const override;
    void readInto(std::size_t offset, u8* target, std::size_t length) const override;
    [[nodiscard]] std::optional<std::span<const u8>> tryGetUint8ArrayView() const override { return std::nullopt; }

private:
    std::string path_;
    int fd_ = -1;
    std::size_t size_ = 0;
};

} // namespace rs

