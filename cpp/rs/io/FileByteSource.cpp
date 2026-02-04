#include "FileByteSource.hpp"

#include <cerrno>
#include <cstring>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>

#include <fcntl.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#include "ByteSource.hpp"
#include "ByteSourceSlice.hpp"
#include "../types.hpp"

namespace rs {

static std::size_t fileSizeOfFd(int fd) {
    struct stat st;
    if (fstat(fd, &st) != 0) {
        throw std::runtime_error(std::string("FileByteSource: fstat failed: ") + std::strerror(errno));
    }
    if (st.st_size < 0) {
        throw std::runtime_error("FileByteSource: invalid file size");
    }
    return static_cast<std::size_t>(st.st_size);
}

FileByteSource::FileByteSource(std::string path) : path_(std::move(path)) {
    fd_ = ::open(path_.c_str(), O_RDONLY);
    if (fd_ < 0) {
        throw std::runtime_error(std::string("FileByteSource: open failed: ") + std::strerror(errno));
    }
    size_ = fileSizeOfFd(fd_);
}

FileByteSource::~FileByteSource() {
    if (fd_ >= 0) {
        ::close(fd_);
        fd_ = -1;
    }
}

ByteSourcePtr FileByteSource::slice(std::size_t start, std::size_t size) const {
    return std::make_shared<ByteSourceSlice>(shared_from_this(), start, size);
}

void FileByteSource::readInto(std::size_t offset, u8* target, std::size_t length) const {
    if (!target && length != 0) {
        throw std::invalid_argument("FileByteSource: target is null");
    }
    if (offset > size_ || length > size_ - offset) {
        throw std::out_of_range("FileByteSource: read out of bounds");
    }
    if (length == 0) {
        return;
    }

    std::size_t done = 0;
    while (done < length) {
        const std::size_t chunk = length - done;
        const ssize_t n = ::pread(fd_, target + done, chunk, static_cast<off_t>(offset + done));
        if (n < 0) {
            if (errno == EINTR) {
                continue;
            }
            throw std::runtime_error(std::string("FileByteSource: pread failed: ") + std::strerror(errno));
        }
        if (n == 0) {
            throw std::runtime_error("FileByteSource: unexpected EOF");
        }
        done += static_cast<std::size_t>(n);
    }
}

} // namespace rs
