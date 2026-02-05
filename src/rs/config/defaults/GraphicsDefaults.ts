import { CacheInfo, GameType } from "../../cache/CacheInfo";
import { CacheSystem } from "../../cache/CacheSystem";
import { OsrsIndexId, Rs2IndexId, Dat2IndexId } from "../../cache/IndexId";
import { ByteBuffer } from "../../io/ByteBuffer";
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
        if (
            cacheInfo.game === GameType.Oldschool &&
            fileSystem.indexExists(OsrsIndexId.graphicDefaults)
        ) {
            const defaultsIndex = fileSystem.getIndex(OsrsIndexId.graphicDefaults);
            const defaultsFile = defaultsIndex.tryGetFile(DefaultsGroup.GRAPHICS, 0);
            if (!defaultsFile) {
                console.error("GraphicsDefaults: file not found");
                return new GraphicsDefaults(-1, cacheInfo);
            }

            const defaults = new GraphicsDefaults(defaultsFile.archiveId, cacheInfo);
            defaults.decode(new ByteBuffer(defaultsFile.data));

            return defaults;
        } else if (
            cacheInfo.game === GameType.Runescape &&
            fileSystem.indexExists(Rs2IndexId.defaults)
        ) {
            const defaults = new GraphicsDefaults(-1, cacheInfo);

            return defaults;
        } else {
            const spriteIndex = fileSystem.tryGetIndex(Dat2IndexId.sprites);
            if (!spriteIndex) {
                console.error("GraphicsDefaults: missing sprite index");
                return new GraphicsDefaults(-1, cacheInfo);
            }

            const defaults = new GraphicsDefaults(-1, cacheInfo);
            defaults.compass = spriteIndex.getArchiveId("compass");
            defaults.mapEdge = spriteIndex.getArchiveId("mapedge");
            defaults.mapScenes = spriteIndex.getArchiveId("mapscene");
            defaults.mapFunctions = spriteIndex.getArchiveId("mapfunction");
            defaults.headIconsPk = spriteIndex.getArchiveId("headicons_pk");
            defaults.headIconsPrayer = spriteIndex.getArchiveId("headicons_prayer");
            defaults.headIconsHint = spriteIndex.getArchiveId("headicons_hint");
            defaults.mapMarkers = spriteIndex.getArchiveId("mapmarker");
            defaults.crosses = spriteIndex.getArchiveId("cross");
            defaults.mapDots = spriteIndex.getArchiveId("mapdots");
            defaults.scrollBars = spriteIndex.getArchiveId("scrollbar");
            defaults.modIcons = spriteIndex.getArchiveId("mod_icons");

            return defaults;
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
