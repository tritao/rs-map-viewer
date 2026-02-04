#include "FileByteSource.hpp"

#include <cstddef>
#include <cerrno>
#include <cstring>

#include <fcntl.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#include "../core/Result.hpp"
#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "../types.hpp"

namespace rs {

static Status fileSizeOfFd(int fd, std::size_t* out) noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    struct stat st;
    if (fstat(fd, &st) != 0) {
        return Status::IoError;
    }
    if (st.st_size < 0) {
        return Status::BadFormat;
    }
    *out = static_cast<std::size_t>(st.st_size);
    return Status::Ok;
}

Result<FileByteSource> FileByteSource::open(const char* path) noexcept {
    if (!path) {
        return Result<FileByteSource>::err(Status::InvalidArgument);
    }

    const int fd = ::open(path, O_RDONLY);
    if (fd < 0) {
        return Result<FileByteSource>::err(Status::IoError);
    }

    std::size_t size = 0;
    const Status st = fileSizeOfFd(fd, &size);
    if (!ok(st)) {
        ::close(fd);
        return Result<FileByteSource>::err(st);
    }

    return Result<FileByteSource>::ok(FileByteSource(fd, size));
}

FileByteSource::FileByteSource(FileByteSource&& other) noexcept : fd_(other.fd_), size_(other.size_) {
    other.fd_ = -1;
    other.size_ = 0;
}

FileByteSource& FileByteSource::operator=(FileByteSource&& other) noexcept {
    if (this == &other) {
        return *this;
    }
    if (fd_ >= 0) {
        ::close(fd_);
    }
    fd_ = other.fd_;
    size_ = other.size_;
    other.fd_ = -1;
    other.size_ = 0;
    return *this;
}

FileByteSource::~FileByteSource() {
    if (fd_ < 0) {
        return;
    }
    ::close(fd_);
    fd_ = -1;
    size_ = 0;
}

Status FileByteSource::readInto(std::size_t offset, Span<u8> target) const noexcept {
    if (!target.data() && target.size() != 0) {
        return Status::InvalidArgument;
    }
    if (offset > size_ || target.size() > size_ - offset) {
        return Status::OutOfRange;
    }
    if (target.size() == 0) {
        return Status::Ok;
    }

    std::size_t done = 0;
    while (done < target.size()) {
        const std::size_t chunk = target.size() - done;
        const ssize_t n = ::pread(fd_, target.data() + done, chunk, static_cast<off_t>(offset + done));
        if (n < 0) {
            if (errno == EINTR) {
                continue;
            }
            return Status::IoError;
        }
        if (n == 0) {
            return Status::Truncated;
        }
        done += static_cast<std::size_t>(n);
    }

    return Status::Ok;
}

} // namespace rs
