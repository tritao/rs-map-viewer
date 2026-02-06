import { CacheInfo, GameType } from "../../cache/CacheInfo";
import { CacheSystem } from "../../cache/CacheSystem";
import { OsrsIndexId, Rs2IndexId, Dat2IndexId } from "../../cache/IndexId";
import { ByteBuffer } from "../../io/ByteBuffer";
import { err, ok, Result } from "../../../util/Result";
import { InitError, missingFile, missingIndex } from "../../loaders/InitError";
import { Type } from "../Type";
import { DefaultsGroup } from "./DefaultsGroup";

export class GraphicsDefaults extends Type {
    compass: number = -1;
    mapEdge: number = -1;
    mapScenes: number = -1;
    mapFunctions: number = -1;
    headIconsPk: number = -1;
    headIconsPrayer: number = -1;
    headIconsHint: number = -1;
    mapMarkers: number = -1;
    crosses: number = -1;
    mapDots: number = -1;
    scrollBars: number = -1;
    modIcons: number = -1;

    static create(cacheInfo: CacheInfo, fileSystem: CacheSystem): GraphicsDefaults {
        const result = GraphicsDefaults.tryCreate(cacheInfo, fileSystem);
        if (result.ok) {
            return result.value;
        }
        return new GraphicsDefaults(-1, cacheInfo);
    }

    static tryCreate(cacheInfo: CacheInfo, fileSystem: CacheSystem): Result<GraphicsDefaults, InitError> {
        const osrsDefaultsIndex = fileSystem.tryGetIndex(OsrsIndexId.graphicDefaults);
        if (cacheInfo.game === GameType.Oldschool && osrsDefaultsIndex) {
            const defaultsFile = osrsDefaultsIndex.tryGetFile(DefaultsGroup.GRAPHICS, 0);
            if (!defaultsFile) {
                return err(missingFile(OsrsIndexId.graphicDefaults, DefaultsGroup.GRAPHICS, 0, "osrs graphics defaults"));
            }

            const defaults = new GraphicsDefaults(defaultsFile.archiveId, cacheInfo);
            defaults.decode(new ByteBuffer(defaultsFile.data));

            return ok(defaults);
        }

        if (cacheInfo.game === GameType.Runescape && fileSystem.tryGetIndex(Rs2IndexId.defaults)) {
            return ok(new GraphicsDefaults(-1, cacheInfo));
        } else {
            const spriteIndex = fileSystem.tryGetIndex(Dat2IndexId.sprites);
            if (!spriteIndex) {
                return err(missingIndex(Dat2IndexId.sprites, "dat2 sprites (for graphics defaults)"));
            }

            const defaults = new GraphicsDefaults(-1, cacheInfo);
            defaults.compass = spriteIndex.tryGetArchiveId("compass") ?? -1;
            defaults.mapEdge = spriteIndex.tryGetArchiveId("mapedge") ?? -1;
            defaults.mapScenes = spriteIndex.tryGetArchiveId("mapscene") ?? -1;
            defaults.mapFunctions = spriteIndex.tryGetArchiveId("mapfunction") ?? -1;
            defaults.headIconsPk = spriteIndex.tryGetArchiveId("headicons_pk") ?? -1;
            defaults.headIconsPrayer = spriteIndex.tryGetArchiveId("headicons_prayer") ?? -1;
            defaults.headIconsHint = spriteIndex.tryGetArchiveId("headicons_hint") ?? -1;
            defaults.mapMarkers = spriteIndex.tryGetArchiveId("mapmarker") ?? -1;
            defaults.crosses = spriteIndex.tryGetArchiveId("cross") ?? -1;
            defaults.mapDots = spriteIndex.tryGetArchiveId("mapdots") ?? -1;
            defaults.scrollBars = spriteIndex.tryGetArchiveId("scrollbar") ?? -1;
            defaults.modIcons = spriteIndex.tryGetArchiveId("mod_icons") ?? -1;

            return ok(defaults);
        }
    }

    override decodeOpcode(opcode: number, buffer: ByteBuffer): void {
        switch (opcode) {
            case 1:
                buffer.readMedium();
                break;
            case 2:
                this.compass = buffer.readBigSmart();
                this.mapEdge = buffer.readBigSmart();
                this.mapScenes = buffer.readBigSmart();
                this.headIconsPk = buffer.readBigSmart();
                this.headIconsPrayer = buffer.readBigSmart();
                this.headIconsHint = buffer.readBigSmart();
                this.mapMarkers = buffer.readBigSmart();
                this.crosses = buffer.readBigSmart();
                this.mapDots = buffer.readBigSmart();
                this.scrollBars = buffer.readBigSmart();
                this.modIcons = buffer.readBigSmart();
                break;
        }
    }
}
