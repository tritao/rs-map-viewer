export enum IncomingPacket {
    REMOVE_LANDSCAPE_OBJECT = 88,
    SET_LANDSCAPE_OBJECT = 152,
    REMOVE_GROUND_ITEM = 208,
    UPDATE_GROUND_ITEM_AMOUNT = 121,
    SET_GROUND_ITEM = 107,
    SET_PLAYER_GROUND_ITEM = 106,
    UPDATE_REGION = 183,
    CLEAR_REGION = 40,

    SHOW_STILL_GRAPHICS = 59,
    SHOW_PROJECTILE = 181,
    SHOW_HINT_ICON = 199,

    PLAY_SOUND = 26,
    PLAY_POSITION_SOUND = 41,
    PLAY_SONG = 220,
    PLAY_TEMP_SONG = 249,

    SYSTEM_UPDATE = 190,
    CHATBOX_MESSAGE = 63,

    CONSTRUCT_MAP_REGION = 53,
    UPDATE_ACTIVE_MAP_REGION = 222,

    SET_WIDGET_ANIMATION = 2,
    SET_WIDGET_ITEM_MODEL = 21,
    SET_WIDGET_PLAYER_HEAD = 255,
    SET_CHAT_INPUT_TYPE_2 = 6,
    SET_WIDGET_MODEL_1 = 216,
    SET_WIDGET_MODEL_2 = 162,
    RESET_WIDGET_SETTINGS = 113,
    FLASH_TAB_ICON = 238,
    SET_TAB_WIDGET = 10,
    SET_ACTIVE_TAB = 252,
    CLEAR_WIDGET_ITEMS = 219,
    UPDATE_ALL_WIDGET_ITEMS = 206,
    UPDATE_WIDGET_ITEMS_BY_SLOT = 134,
    UPDATE_WIDGET_SETTING_LARGE = 115,
    UPDATE_WIDGET_SETTING_SMALL = 182,
    UPDATE_CHAT_SETTINGS = 201,
    UPDATE_WIDGET_COLOR = 218,
    UPDATE_WIDGET_STRING = 232,
    UPDATE_WIDGET_SCROLL_POSITION = 200,
    UPDATE_WIDGET_MODEL_DISPLAY = 186,
    HIDE_WIDGET = 82,
    UPDATE_WIDGET_POSITION = 166,
    SHOW_SIDEBAR_OVERLAY_WIDGET = 246,
    SHOW_GAME_WIDGET = 159,
    SHOW_SIDEBAR_AND_GAME_WIDGET = 128,
    SHOW_WALKABLE_WIDGET = 50,
    UPDATE_WELCOME_SCREEN = 76,
    SHOW_DIALOG = 158,
    SHOW_CHATBOX_WIDGET = 109,
    SHOW_FULLSCREEN_WIDGET = 253,
    CLOSE_ALL_WIDGETS = 29,
    SET_MINIMAP_STATE = 156,

    PLAYER_UPDATING = 90,
    NPC_UPDATING = 71,
    RESET_MOB_ANIMATIONS = 13,

    UPDATE_FRIEND_LIST_STATUS = 251,
    UPDATE_IGNORE_LIST = 226,
    PRIVATE_MESSAGE_RECEIVED = 135,
    UPDATE_FRIEND = 78,
    UPDATE_PLAYER_CONTEXT_OPTION = 157,

    SEND_REFERENCE_POSITION = 75,

    UPDATE_MEMBERSHIP_AND_WORLD_INDEX = 126,
    UPDATE_RUN_ENERGY = 125,
    UPDATE_SKILL = 49,
    UPDATE_CARRY_WEIGHT = 174,
    SEND_LOGOUT = 5,

    RESET_CUTSCENE_CAMERA = 148,
    MOVE_CUTSCENE_CAMERA = 167,
    CAMERA_SHAKE = 67
}

export enum RegionUpdateOpcode {
    UNKNOWN1 = 203,
    REMOVE_OBJECT = IncomingPacket.REMOVE_LANDSCAPE_OBJECT,
    SEND_OBJECT = IncomingPacket.SET_LANDSCAPE_OBJECT,
    SEND_PROJECTILE = IncomingPacket.SHOW_PROJECTILE,
    ADD_PUBLIC_TILE_ITEM = IncomingPacket.SET_PLAYER_GROUND_ITEM,
    ADD_TILE_ITEM = IncomingPacket.SET_GROUND_ITEM,
    UPDATE_TILE_ITEM = IncomingPacket.UPDATE_GROUND_ITEM_AMOUNT,
    REMOVE_TILE_ITEM = IncomingPacket.REMOVE_GROUND_ITEM,
    PLAY_POSITION_SOUND = IncomingPacket.PLAY_POSITION_SOUND,
    SHOW_STILL_GRAPHICS = IncomingPacket.SHOW_STILL_GRAPHICS
}

export enum LoginType {
    CREATE_SESSION = 16,
    CLAIM_EXISTING_SESSION = 18,
}

export enum OutgoingPacket {
    KEEP_ALIVE = 40
}

export enum NpcUpdateMask {
    TRANSFORM = 0x1,
    ANIMATION = 0x2,
    GRAPHIC = 0x4,
    TURN_TO_POSITION = 0x8,
    SECONDARY_HIT_UPDATE = 0x10,
    FORCE_CHAT = 0x20,
    INTERACTING_MOB = 0x40,
    HIT_UPDATE = 0x80,
}

export enum PlayerUpdateMask {
    INTERACTING_MOB = 0x1,
    TURN_TO_POSITION = 0x2,
    APPEARANCE = 0x4,
    ANIMATION = 0x8,
    FORCE_CHAT = 0x10,
    HAS_MORE_DATA = 0x20,
    CHAT = 0x40,
    HIT_UPDATE = 0x80,
    FORCE_MOVEMENT = 0x100,
    GRAPHIC = 0x200,
    SECONDARY_HIT_UPDATE = 0x400,
}

export enum MovementType {
    NONE = 0,
    WALK = 1,
    RUN = 2,
    TELEPORT = 3
}

export enum LoginStatus {
    /** Exchange data login status */
    EXCHANGE_DATA = 0,

    /** Delay for 2 seconds login status */
    DELAY = 1,

    /** OK login status */
    OK = 2,

    /** Invalid credentials login status */
    INVALID_CREDENTIALS = 3,

    /** Account disabled login status */
    ACCOUNT_DISABLED = 4,

    /** Account online login status */
    ACCOUNT_ONLINE = 5,

    /** Game updated login status */
    GAME_UPDATED = 6,

    /** Server full login status */
    SERVER_FULL = 7,

    /** Login server offline login status */
    LOGIN_SERVER_OFFLINE = 8,

    /** Too many connections login status */
    TOO_MANY_CONNECTIONS = 9,

    /** Bad session id login status */
    BAD_SESSION_ID = 10,

    /** Login server rejected session login status */
    LOGIN_SERVER_REJECTED_SESSION = 11,

    /** Members account required login status */
    MEMBERS_ACCOUNT_REQUIRED = 12,

    /** Could not complete login status */
    COULD_NOT_COMPLETE = 13,

    /** Server updating login status */
    UPDATING = 14,

    /** Reconnection OK login status */
    RECONNECTION_OK = 15,

    /** Too many login attempts login status */
    TOO_MANY_LOGINS = 16,

    /** Standing in members area on free world status */
    IN_MEMBERS_AREA = 17,

    /** Locked login status */
    LOCKED = 18,

    /** Invalid login server status */
    INVALID_LOGIN_SERVER = 20,

    /** Profile transfer login status */
    PROFILE_TRANSFER = 21,

    MALFORMED_PACKET = 22,

    NO_REPLY = 23,

    LOADING_ERROR = 24,

    UNEXPECTED_RESPONSE = 25,

    ADDRESS_BLOCKED = 26
}

export class PacketConstants {
    public static PACKET_SIZES: number[] = [
        0, 0, 4, 6, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 6, 0, 0, 6, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 2, 4, 0, 0, 0, 0, 0, 0, 0, 6, 2, 0, 0, -2, 0, 0, 0, 0, 0, 6, 0, 0, 0, -1,
        0, 0, 0, 4, 0, 0, 0, -2, 0, 0, 0, 2, 23, 0, 9, 0, 0, 0, 3, 0, 0, 0, 0, 0, 2, 0, -2, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7, 5, 0, 2, 0, 0, 0, 0, 0, 6, 0, 0, 0, 0, 0, 7, 0, 0, 0, 1, 3, 0, 4,
        0, 0, 0, 0, 0, -2, -1, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 1, -1, 2, 2, 0,
        0, 4, 0, 0, 0, 6, 6, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 15, 3, -2, 0, 0, 8, 6, 0, 0, 2, 0, 0,
        0, 0, 0, 0, 0, 0, 6, 4, 3, 0, 14, 0, 0, -2, 0, 3, 0, 0, 0, 0, 0, 0, 0, 4, 0, 4, 2, 2, 0, 4, 0, 0, 0,
        -2, 0, 0, 0, 0, 0, -2, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 5, 0, 1, 1, 4, 0, 2, 0
    ];
}
