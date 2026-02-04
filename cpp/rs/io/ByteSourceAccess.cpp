#include "ByteSourceAccess.hpp"

#include <stdexcept>

namespace rs {

ByteSourceAccess::ByteSourceAccess(ByteSourcePtr source) : source_(std::move(source)) {
    if (!source_) {
        throw std::invalid_argument("ByteSourceAccess: source is null");
    }
    const auto v = source_->tryGetUint8ArrayView();
    if (v && v->size() == source_->size()) {
        view_ = *v;
    }
}

std::optional<std::span<const u8>> ByteSourceAccess::tryView(std::size_t offset, std::size_t length) const {
    if (offset > source_->size() || length > source_->size() - offset) {
        throw std::out_of_range("ByteSourceAccess: out of bounds");
    }
    if (!view_) {
        return std::nullopt;
    }
    return view_->subspan(offset, length);
}

std::vector<u8> ByteSourceAccess::copyBytes(std::size_t offset, std::size_t length) const {
    if (offset > source_->size() || length > source_->size() - offset) {
        throw std::out_of_range("ByteSourceAccess: out of bounds");
    }
    std::vector<u8> out;
    out.resize(length);
    if (length == 0) {
        return out;
    }
    source_->readInto(offset, out.data(), length);
    return out;
}

void ByteSourceAccess::readInto(std::size_t offset, u8* target, std::size_t length) const {
    if (offset > source_->size() || length > source_->size() - offset) {
        throw std::out_of_range("ByteSourceAccess: out of bounds");
    }
    source_->readInto(offset, target, length);
}

} // namespace rs

