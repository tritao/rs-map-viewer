#include "SceneBuffer.hpp"

#include "RuntimeCommandStreamPlan.hpp"
#include "PackedVertex.hpp"
#include "PackedVertexDedupe.hpp"

namespace rs {

namespace {

static constexpr i32 kSceneCommandProvenanceStrideInts = 12;

static i32 roundHeightOffsetDiv8Js(i32 heightOffset) noexcept {
    if (heightOffset >= 0) {
        return (heightOffset + 4) / 8;
    }
    return -(((-heightOffset) + 3) / 8);
}

static Status resizeWithZeroFill(Vec<u16>* out, std::size_t size) noexcept {
    auto rr = out->resize(size);
    if (!rr.isOk()) {
        return rr.status();
    }
    for (std::size_t i = 0; i < size; i++) {
        (*out)[i] = 0;
    }
    return Status::Ok;
}

} // namespace

Result<void> SceneBuffer::init(Allocator& alloc) noexcept {
    vertices = Vec<u8>(alloc);
    indices = Vec<i32>(alloc);
    instances = Vec<ModelInfo>(alloc);
    deferredInstances = Vec<ModelInfo>(alloc);
    drawCommands = Vec<DrawCommand>(alloc);
    drawCommandsAlpha = Vec<DrawCommand>(alloc);
    drawCommandsLod = Vec<DrawCommand>(alloc);
    drawCommandsLodAlpha = Vec<DrawCommand>(alloc);
    drawCommandsInteract = Vec<DrawCommand>(alloc);
    drawCommandsInteractAlpha = Vec<DrawCommand>(alloc);
    drawCommandsInteractLod = Vec<DrawCommand>(alloc);
    drawCommandsInteractLodAlpha = Vec<DrawCommand>(alloc);
    deferredDrawCommands = Vec<DrawCommand>(alloc);
    deferredDrawCommandsAlpha = Vec<DrawCommand>(alloc);
    deferredDrawCommandsLod = Vec<DrawCommand>(alloc);
    deferredDrawCommandsLodAlpha = Vec<DrawCommand>(alloc);
    deferredDrawCommandsInteract = Vec<DrawCommand>(alloc);
    deferredDrawCommandsInteractAlpha = Vec<DrawCommand>(alloc);
    deferredDrawCommandsInteractLod = Vec<DrawCommand>(alloc);
    deferredDrawCommandsInteractLodAlpha = Vec<DrawCommand>(alloc);
    return Result<void>::ok();
}

void SceneBuffer::clear() noexcept {
    vertices.clear();
    indices.clear();
    instances.clear();
    deferredInstances.clear();
    drawCommands.clear();
    drawCommandsAlpha.clear();
    drawCommandsLod.clear();
    drawCommandsLodAlpha.clear();
    drawCommandsInteract.clear();
    drawCommandsInteractAlpha.clear();
    drawCommandsInteractLod.clear();
    drawCommandsInteractLodAlpha.clear();
    deferredDrawCommands.clear();
    deferredDrawCommandsAlpha.clear();
    deferredDrawCommandsLod.clear();
    deferredDrawCommandsLodAlpha.clear();
    deferredDrawCommandsInteract.clear();
    deferredDrawCommandsInteractAlpha.clear();
    deferredDrawCommandsInteractLod.clear();
    deferredDrawCommandsInteractLodAlpha.clear();
}

i32 SceneBuffer::indexByteOffset() const noexcept {
    if (indices.size() > static_cast<std::size_t>(2147483647 / 4)) {
        return 2147483647;
    }
    return static_cast<i32>(indices.size() * 4);
}

Status SceneBuffer::addIndex(i32 index) noexcept {
    auto rr = indices.pushBack(index);
    return rr.status();
}

Status SceneBuffer::appendIndices(Span<const i32> values) noexcept {
    if (values.size() == 0) {
        return Status::Ok;
    }
    auto rr = indices.reserve(indices.size() + values.size());
    if (!rr.isOk()) {
        return rr.status();
    }
    for (std::size_t i = 0; i < values.size(); i++) {
        rr = indices.pushBack(values[i]);
        if (!rr.isOk()) {
            return rr.status();
        }
    }
    return Status::Ok;
}

Status SceneBuffer::finalizeGeometry(
    i32 indexCount,
    i32 debugProbeFinalVertexIndex,
    i32* outProbeOldVertexIndex,
    i32* outProbeVertexU32,
    Allocator& alloc) noexcept {
    if (indexCount < 0) {
        return Status::OutOfRange;
    }
    if (vertices.empty() && indexCount > 0) {
        // Renderer expects at least one vertex if any indices exist.
        const Status vs = PackedVertex::append(&vertices, 0, 0, 0, 0, 0xff, 0.0f, 0.0f, 0);
        if (!ok(vs)) {
            return vs;
        }
    }
    while (static_cast<i32>(indices.size()) < indexCount) {
        auto rr = indices.pushBack(0);
        if (!rr.isOk()) {
            return rr.status();
        }
    }
    return dedupePackedVerticesAndRemapIndices(
        &vertices,
        &indices,
        debugProbeFinalVertexIndex,
        outProbeOldVertexIndex,
        outProbeVertexU32,
        alloc);
}

Vec<DrawCommand>* SceneBuffer::bucketVec(DrawBucketKey bucket, bool defer) noexcept {
    switch (bucket) {
    case DrawBucketKey::Base:
        return defer ? &deferredDrawCommands : &drawCommands;
    case DrawBucketKey::Alpha:
        return defer ? &deferredDrawCommandsAlpha : &drawCommandsAlpha;
    case DrawBucketKey::Lod:
        return defer ? &deferredDrawCommandsLod : &drawCommandsLod;
    case DrawBucketKey::LodAlpha:
        return defer ? &deferredDrawCommandsLodAlpha : &drawCommandsLodAlpha;
    case DrawBucketKey::Interact:
        return defer ? &deferredDrawCommandsInteract : &drawCommandsInteract;
    case DrawBucketKey::InteractAlpha:
        return defer ? &deferredDrawCommandsInteractAlpha : &drawCommandsInteractAlpha;
    case DrawBucketKey::InteractLod:
        return defer ? &deferredDrawCommandsInteractLod : &drawCommandsInteractLod;
    case DrawBucketKey::InteractLodAlpha:
        return defer ? &deferredDrawCommandsInteractLodAlpha : &drawCommandsInteractLodAlpha;
    default:
        return nullptr;
    }
}

const Vec<DrawCommand>* SceneBuffer::bucketVec(DrawBucketKey bucket, bool defer) const noexcept {
    switch (bucket) {
    case DrawBucketKey::Base:
        return defer ? &deferredDrawCommands : &drawCommands;
    case DrawBucketKey::Alpha:
        return defer ? &deferredDrawCommandsAlpha : &drawCommandsAlpha;
    case DrawBucketKey::Lod:
        return defer ? &deferredDrawCommandsLod : &drawCommandsLod;
    case DrawBucketKey::LodAlpha:
        return defer ? &deferredDrawCommandsLodAlpha : &drawCommandsLodAlpha;
    case DrawBucketKey::Interact:
        return defer ? &deferredDrawCommandsInteract : &drawCommandsInteract;
    case DrawBucketKey::InteractAlpha:
        return defer ? &deferredDrawCommandsInteractAlpha : &drawCommandsInteractAlpha;
    case DrawBucketKey::InteractLod:
        return defer ? &deferredDrawCommandsInteractLod : &drawCommandsInteractLod;
    case DrawBucketKey::InteractLodAlpha:
        return defer ? &deferredDrawCommandsInteractLodAlpha : &drawCommandsInteractLodAlpha;
    default:
        return nullptr;
    }
}

Status SceneBuffer::emitToBuckets(
    Span<const DrawBucketKey> buckets,
    i32 offset,
    i32 elements,
    Span<const ModelInfo> commandInstances,
    bool defer,
    const DebugCommandProvenance* debugProvenance) noexcept {
    if (offset < 0 || elements < 0) {
        return Status::InvalidArgument;
    }
    if (buckets.size() == 0) {
        return Status::InvalidArgument;
    }
    if (commandInstances.size() > static_cast<std::size_t>(2147483647)) {
        return Status::OutOfRange;
    }
    if (instances.size() > static_cast<std::size_t>(2147483647)) {
        return Status::OutOfRange;
    }

    auto rr = instances.reserve(instances.size() + commandInstances.size());
    if (!rr.isOk()) {
        return rr.status();
    }

    for (std::size_t i = 0; i < buckets.size(); i++) {
        Vec<DrawCommand>* commands = bucketVec(buckets[i], defer);
        if (!commands) {
            return Status::InvalidArgument;
        }
        rr = commands->reserve(commands->size() + 1);
        if (!rr.isOk()) {
            return rr.status();
        }
    }

    Vec<ModelInfo>* pool = defer ? &deferredInstances : &instances;
    const i32 poolKind = defer ? 1 : 0;
    const i32 instanceStart = static_cast<i32>(pool->size());
    const i32 instanceCount = static_cast<i32>(commandInstances.size());
    for (std::size_t i = 0; i < commandInstances.size(); i++) {
        rr = pool->pushBack(commandInstances[i]);
        if (!rr.isOk()) {
            return rr.status();
        }
    }

    DrawCommand command{};
    command.offset = offset;
    command.elements = elements;
    command.instanceStart = instanceStart;
    command.instanceCount = instanceCount;
    command.instancePoolKind = static_cast<u8>(poolKind);
    command.debugProvenance = debugProvenance ? *debugProvenance : DebugCommandProvenance{};

    for (std::size_t i = 0; i < buckets.size(); i++) {
        Vec<DrawCommand>* commands = bucketVec(buckets[i], defer);
        if (!commands) {
            return Status::InvalidArgument;
        }
        rr = commands->pushBack(command);
        if (!rr.isOk()) {
            return rr.status();
        }
    }

    return Status::Ok;
}

Status SceneBuffer::emitCommandToBucket(
    DrawBucketKey bucket,
    i32 offset,
    i32 elements,
    Span<const ModelInfo> commandInstances,
    bool defer,
    const DebugCommandProvenance* debugProvenance) noexcept {
    const DrawBucketKey keys[1] = {bucket};
    return emitToBuckets(
        Span<const DrawBucketKey>(keys, 1),
        offset,
        elements,
        commandInstances,
        defer,
        debugProvenance);
}

Status SceneBuffer::emitMergedCommand(
    i32 offset,
    i32 elements,
    Span<const ModelInfo> commandInstances,
    bool transparent,
    bool includeLod,
    bool defer,
    const DebugCommandProvenance* debugProvenance) noexcept {
    DrawBucketKey keys[2];
    std::size_t count = 0;
    if (transparent) {
        keys[count++] = DrawBucketKey::Alpha;
        if (includeLod) {
            keys[count++] = DrawBucketKey::LodAlpha;
        }
    } else {
        keys[count++] = DrawBucketKey::Base;
        if (includeLod) {
            keys[count++] = DrawBucketKey::Lod;
        }
    }
    return emitToBuckets(
        Span<const DrawBucketKey>(keys, count),
        offset,
        elements,
        commandInstances,
        defer,
        debugProvenance);
}

Status SceneBuffer::emitInteractCommand(
    i32 offset,
    i32 elements,
    Span<const ModelInfo> commandInstances,
    bool transparent,
    bool includeLod,
    bool defer,
    const DebugCommandProvenance* debugProvenance) noexcept {
    DrawBucketKey keys[2];
    std::size_t count = 0;
    if (transparent) {
        keys[count++] = DrawBucketKey::InteractAlpha;
        if (includeLod) {
            keys[count++] = DrawBucketKey::InteractLodAlpha;
        }
    } else {
        keys[count++] = DrawBucketKey::Interact;
        if (includeLod) {
            keys[count++] = DrawBucketKey::InteractLod;
        }
    }
    return emitToBuckets(
        Span<const DrawBucketKey>(keys, count),
        offset,
        elements,
        commandInstances,
        defer,
        debugProvenance);
}

i32 SceneBuffer::bucketCommandCount(DrawBucketKey bucket) const noexcept {
    const Vec<DrawCommand>* commands = bucketVec(bucket, false);
    const Vec<DrawCommand>* deferred = bucketVec(bucket, true);
    if (!commands || !deferred) {
        return 0;
    }
    if (commands->size() > static_cast<std::size_t>(2147483647) ||
        deferred->size() > static_cast<std::size_t>(2147483647)) {
        return 0;
    }
    const i32 a = static_cast<i32>(commands->size());
    const i32 b = static_cast<i32>(deferred->size());
    if (b > 2147483647 - a) {
        return 0;
    }
    return a + b;
}

Span<const DrawCommand> SceneBuffer::bucketCommands(DrawBucketKey bucket) const noexcept {
    const Vec<DrawCommand>* commands = bucketVec(bucket, false);
    if (!commands) {
        return Span<const DrawCommand>(nullptr, 0);
    }
    return commands->span();
}

Span<const DrawCommand> SceneBuffer::bucketDeferredCommands(DrawBucketKey bucket) const noexcept {
    const Vec<DrawCommand>* commands = bucketVec(bucket, true);
    if (!commands) {
        return Span<const DrawCommand>(nullptr, 0);
    }
    return commands->span();
}

Status SceneBuffer::appendCommandStream(SceneCommandStream* out, Allocator& alloc) const noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    (void)alloc;
    // Preserve debug vectors so the builder can compute them around this packing step without
    // save/restore. Geometry is owned by SceneBuffer and emitted here.
    out->cmdBucketIndices.clear();
    out->cmdOffsets.clear();
    out->cmdElements.clear();
    out->cmdInstanceCounts.clear();
    out->cmdPackedInstances.clear();
    out->debugCommandProvenancePacked.clear();
    out->vertices.clear();
    out->indices.clear();

    const Vec<DrawCommand>* orderedBuckets[kDrawBucketCount] = {
        &drawCommands,
        &drawCommandsAlpha,
        &drawCommandsLod,
        &drawCommandsLodAlpha,
        &drawCommandsInteract,
        &drawCommandsInteractAlpha,
        &drawCommandsInteractLod,
        &drawCommandsInteractLodAlpha,
    };
    const Vec<DrawCommand>* orderedBucketsDeferred[kDrawBucketCount] = {
        &deferredDrawCommands,
        &deferredDrawCommandsAlpha,
        &deferredDrawCommandsLod,
        &deferredDrawCommandsLodAlpha,
        &deferredDrawCommandsInteract,
        &deferredDrawCommandsInteractAlpha,
        &deferredDrawCommandsInteractLod,
        &deferredDrawCommandsInteractLodAlpha,
    };

    i32 totalCmdCount = 0;
    i32 totalInstances = 0;
    for (i32 bucket = 0; bucket < kDrawBucketCount; bucket++) {
        const Vec<DrawCommand>& commands = *orderedBuckets[static_cast<std::size_t>(bucket)];
        const Vec<DrawCommand>& deferredCommands =
            *orderedBucketsDeferred[static_cast<std::size_t>(bucket)];
        if (commands.size() > static_cast<std::size_t>(2147483647)) {
            return Status::OutOfRange;
        }
        if (deferredCommands.size() > static_cast<std::size_t>(2147483647)) {
            return Status::OutOfRange;
        }
        const i32 commandCount = static_cast<i32>(commands.size());
        const i32 deferredCommandCount = static_cast<i32>(deferredCommands.size());
        if (commandCount > 2147483647 - totalCmdCount) {
            return Status::OutOfRange;
        }
        totalCmdCount += commandCount;
        for (std::size_t i = 0; i < commands.size(); i++) {
            const DrawCommand& command = commands[i];
            if (command.instanceCount < 0 || command.instanceStart < 0) {
                return Status::BadFormat;
            }
            if (command.instanceCount > 2147483647 - totalInstances) {
                return Status::OutOfRange;
            }
            totalInstances += command.instanceCount;
        }
        if (deferredCommandCount > 2147483647 - totalCmdCount) {
            return Status::OutOfRange;
        }
        totalCmdCount += deferredCommandCount;
        for (std::size_t i = 0; i < deferredCommands.size(); i++) {
            const DrawCommand& command = deferredCommands[i];
            if (command.instanceCount < 0 || command.instanceStart < 0) {
                return Status::BadFormat;
            }
            if (command.instanceCount > 2147483647 - totalInstances) {
                return Status::OutOfRange;
            }
            totalInstances += command.instanceCount;
        }
    }

    auto rr = out->cmdBucketIndices.resize(static_cast<std::size_t>(totalCmdCount));
    if (!rr.isOk()) return rr.status();
    rr = out->cmdOffsets.resize(static_cast<std::size_t>(totalCmdCount));
    if (!rr.isOk()) return rr.status();
    rr = out->cmdElements.resize(static_cast<std::size_t>(totalCmdCount));
    if (!rr.isOk()) return rr.status();
    rr = out->cmdInstanceCounts.resize(static_cast<std::size_t>(totalCmdCount));
    if (!rr.isOk()) return rr.status();

    if (totalCmdCount > (2147483647 / kSceneCommandProvenanceStrideInts)) {
        return Status::OutOfRange;
    }
    rr = out->debugCommandProvenancePacked.resize(
        static_cast<std::size_t>(totalCmdCount * kSceneCommandProvenanceStrideInts));
    if (!rr.isOk()) return rr.status();

    if (totalInstances > (2147483647 / kSceneCommandInstanceStrideInts)) {
        return Status::OutOfRange;
    }
    rr = out->cmdPackedInstances.resize(
        static_cast<std::size_t>(totalInstances * kSceneCommandInstanceStrideInts));
    if (!rr.isOk()) return rr.status();

    i32 cmdCursor = 0;
    i32 packedInstanceCursor = 0;
    for (i32 bucket = 0; bucket < kDrawBucketCount; bucket++) {
        const auto appendCommands = [&](const Vec<DrawCommand>& commands) noexcept -> Status {
            for (std::size_t i = 0; i < commands.size(); i++) {
                const DrawCommand& command = commands[i];
            if (command.offset < 0 || command.elements < 0) {
                return Status::BadFormat;
            }
            const i32 instanceEnd = command.instanceStart + command.instanceCount;
            if (instanceEnd < command.instanceStart) {
                return Status::OutOfRange;
            }
            const Vec<ModelInfo>* pool =
                (command.instancePoolKind == 1) ? &deferredInstances : &instances;
            if (instanceEnd > static_cast<i32>(pool->size())) {
                return Status::BadFormat;
            }

            out->cmdBucketIndices[static_cast<std::size_t>(cmdCursor)] = bucket;
            out->cmdOffsets[static_cast<std::size_t>(cmdCursor)] = command.offset;
            out->cmdElements[static_cast<std::size_t>(cmdCursor)] = command.elements;
            out->cmdInstanceCounts[static_cast<std::size_t>(cmdCursor)] = command.instanceCount;

            const i32 provenanceOff = cmdCursor * kSceneCommandProvenanceStrideInts;
            out->debugCommandProvenancePacked[static_cast<std::size_t>(provenanceOff + 0)] = bucket;
            out->debugCommandProvenancePacked[static_cast<std::size_t>(provenanceOff + 1)] = command.offset;
            out->debugCommandProvenancePacked[static_cast<std::size_t>(provenanceOff + 2)] = command.elements;
            out->debugCommandProvenancePacked[static_cast<std::size_t>(provenanceOff + 3)] = command.debugProvenance.sourceKind;
            out->debugCommandProvenancePacked[static_cast<std::size_t>(provenanceOff + 4)] = command.debugProvenance.locTypeId;
            out->debugCommandProvenancePacked[static_cast<std::size_t>(provenanceOff + 5)] = command.debugProvenance.placementType;
            out->debugCommandProvenancePacked[static_cast<std::size_t>(provenanceOff + 6)] = command.debugProvenance.placementRotation;
            out->debugCommandProvenancePacked[static_cast<std::size_t>(provenanceOff + 7)] = command.debugProvenance.variantType;
            out->debugCommandProvenancePacked[static_cast<std::size_t>(provenanceOff + 8)] = command.debugProvenance.variantRotation;
            out->debugCommandProvenancePacked[static_cast<std::size_t>(provenanceOff + 9)] = command.debugProvenance.pass;
            out->debugCommandProvenancePacked[static_cast<std::size_t>(provenanceOff + 10)] = command.debugProvenance.mergePath;
            out->debugCommandProvenancePacked[static_cast<std::size_t>(provenanceOff + 11)] = command.debugProvenance.splitSignature;

            for (i32 j = 0; j < command.instanceCount; j++) {
                const ModelInfo& inst = (*pool)[static_cast<std::size_t>(command.instanceStart + j)];
                const i32 outOff = packedInstanceCursor * kSceneCommandInstanceStrideInts;
                out->cmdPackedInstances[static_cast<std::size_t>(outOff + 0)] = inst.sceneX;
                out->cmdPackedInstances[static_cast<std::size_t>(outOff + 1)] = inst.sceneZ;
                out->cmdPackedInstances[static_cast<std::size_t>(outOff + 2)] = inst.heightOffset;
                out->cmdPackedInstances[static_cast<std::size_t>(outOff + 3)] = inst.level;
                out->cmdPackedInstances[static_cast<std::size_t>(outOff + 4)] = inst.contourGround;
                out->cmdPackedInstances[static_cast<std::size_t>(outOff + 5)] = inst.priority;
                out->cmdPackedInstances[static_cast<std::size_t>(outOff + 6)] = inst.interactType;
                out->cmdPackedInstances[static_cast<std::size_t>(outOff + 7)] = inst.interactId;
                packedInstanceCursor++;
            }
            cmdCursor++;
            }
            return Status::Ok;
        };

        const Vec<DrawCommand>& commands = *orderedBuckets[static_cast<std::size_t>(bucket)];
        Status s = appendCommands(commands);
        if (!ok(s)) return s;
        const Vec<DrawCommand>& deferredCommands =
            *orderedBucketsDeferred[static_cast<std::size_t>(bucket)];
        s = appendCommands(deferredCommands);
        if (!ok(s)) return s;
    }

    if (cmdCursor != totalCmdCount || packedInstanceCursor != totalInstances) {
        return Status::BadFormat;
    }

    auto rrVerts = out->vertices.resize(vertices.size());
    if (!rrVerts.isOk()) return rrVerts.status();
    for (std::size_t i = 0; i < vertices.size(); i++) {
        out->vertices[i] = vertices[i];
    }

    auto rrIdx = out->indices.resize(indices.size());
    if (!rrIdx.isOk()) return rrIdx.status();
    for (std::size_t i = 0; i < indices.size(); i++) {
        out->indices[i] = indices[i];
    }

    return Status::Ok;
}

Status packDrawRangesForBucket(
    const SceneBuffer& buffer,
    DrawBucketKey bucket,
    Vec<i32>* outDrawRanges,
    Allocator& alloc) noexcept {
    if (!outDrawRanges) {
        return Status::InvalidArgument;
    }
    *outDrawRanges = Vec<i32>(alloc);
    const Span<const DrawCommand> commands = buffer.bucketCommands(bucket);
    const Span<const DrawCommand> deferredCommands = buffer.bucketDeferredCommands(bucket);
    const std::size_t total = commands.size() + deferredCommands.size();
    auto rr = outDrawRanges->resize(total * 3);
    if (!rr.isOk()) {
        return rr.status();
    }
    std::size_t outIdx = 0;
    for (std::size_t i = 0; i < commands.size(); i++, outIdx++) {
        const DrawCommand& cmd = commands[i];
        const std::size_t off = outIdx * 3;
        (*outDrawRanges)[off + 0] = cmd.offset;
        (*outDrawRanges)[off + 1] = cmd.elements;
        (*outDrawRanges)[off + 2] = cmd.instanceCount;
    }
    for (std::size_t i = 0; i < deferredCommands.size(); i++, outIdx++) {
        const DrawCommand& cmd = deferredCommands[i];
        const std::size_t off = outIdx * 3;
        (*outDrawRanges)[off + 0] = cmd.offset;
        (*outDrawRanges)[off + 1] = cmd.elements;
        (*outDrawRanges)[off + 2] = cmd.instanceCount;
    }
    return Status::Ok;
}

Status createModelInfoTextureData(
    const SceneBuffer& buffer,
    DrawBucketKey bucket,
    Vec<u16>* outTextureData,
    Allocator& alloc) noexcept {
    if (!outTextureData) {
        return Status::InvalidArgument;
    }
    *outTextureData = Vec<u16>(alloc);

    const Span<const DrawCommand> commands = buffer.bucketCommands(bucket);
    const Span<const DrawCommand> deferredCommands = buffer.bucketDeferredCommands(bucket);
    i32 instanceCount = 0;
    const auto countInstances = [&](const Span<const DrawCommand> cmds) noexcept -> Status {
        for (std::size_t i = 0; i < cmds.size(); i++) {
            const DrawCommand& cmd = cmds[i];
        if (cmd.instanceCount < 0 || cmd.instanceStart < 0) {
            return Status::BadFormat;
        }
        if (cmd.instanceCount > 2147483647 - instanceCount) {
            return Status::OutOfRange;
        }
        instanceCount += cmd.instanceCount;
        }
        return Status::Ok;
    };
    Status s = countInstances(commands);
    if (!ok(s)) return s;
    s = countInstances(deferredCommands);
    if (!ok(s)) return s;
    const std::size_t totalCmdSize = commands.size() + deferredCommands.size();
    if (totalCmdSize > static_cast<std::size_t>(2147483647)) {
        return Status::OutOfRange;
    }
    const i32 cmdCount = static_cast<i32>(totalCmdSize);
    const i32 textureLength = runtimeCommandModelInfoTextureLengthFromCounts(cmdCount, instanceCount);
    if (textureLength < 0) {
        return Status::OutOfRange;
    }

    const Status resizeStatus = resizeWithZeroFill(
        outTextureData,
        static_cast<std::size_t>(textureLength));
    if (!ok(resizeStatus)) {
        return resizeStatus;
    }

    i32 dataOffset = 0;
    for (i32 i = 0; i < cmdCount; i++) {
        const DrawCommand& cmd =
            (static_cast<std::size_t>(i) < commands.size())
                ? commands[static_cast<std::size_t>(i)]
                : deferredCommands[static_cast<std::size_t>(i) - commands.size()];
        (*outTextureData)[static_cast<std::size_t>(i * 4)] =
            static_cast<u16>(cmdCount + dataOffset);
        dataOffset += cmd.instanceCount;
    }

    i32 instanceCursor = 0;
    const auto emitInstances = [&](const Span<const DrawCommand> cmds) noexcept -> Status {
        for (std::size_t cmdIdx = 0; cmdIdx < cmds.size(); cmdIdx++) {
            const DrawCommand& cmd = cmds[cmdIdx];
        const i32 instanceEnd = cmd.instanceStart + cmd.instanceCount;
        const Vec<ModelInfo>* pool =
            (cmd.instancePoolKind == 1) ? &buffer.deferredInstances : &buffer.instances;
        if (instanceEnd < cmd.instanceStart ||
            instanceEnd > static_cast<i32>(pool->size())) {
            return Status::BadFormat;
        }
        for (i32 i = 0; i < cmd.instanceCount; i++) {
            const ModelInfo& data =
                (*pool)[static_cast<std::size_t>(cmd.instanceStart + i)];
            const i32 outOff = cmdCount * 4 + instanceCursor * 4;
            (*outTextureData)[static_cast<std::size_t>(outOff + 0)] =
                static_cast<u16>(data.sceneX | (data.level << 14));
            (*outTextureData)[static_cast<std::size_t>(outOff + 1)] =
                static_cast<u16>(data.sceneZ | (data.contourGround << 14));
            const i32 packed =
                (data.priority & 0x7) |
                ((data.interactId >> 16) << 3) |
                (data.interactType << 4) |
                (roundHeightOffsetDiv8Js(data.heightOffset) << 6);
            (*outTextureData)[static_cast<std::size_t>(outOff + 2)] =
                static_cast<u16>(packed);
            (*outTextureData)[static_cast<std::size_t>(outOff + 3)] =
                static_cast<u16>(data.interactId);
            instanceCursor++;
        }
        }
        return Status::Ok;
    };
    s = emitInstances(commands);
    if (!ok(s)) return s;
    s = emitInstances(deferredCommands);
    if (!ok(s)) return s;

    if (instanceCursor != instanceCount) {
        return Status::BadFormat;
    }
    return Status::Ok;
}

} // namespace rs
