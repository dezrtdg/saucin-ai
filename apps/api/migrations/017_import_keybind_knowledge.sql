-- Import high-confidence registered keybinds from the September 3, 2026 resource scan.
-- Review-queue, hard-coded, staff/admin, debug, and internal bindings are intentionally excluded.

INSERT INTO knowledge_categories (key,label,description,sort_order,enabled)
VALUES ('keybinds','Keybinds & Controls','Verified player-facing default controls detected in active server resources.',35,TRUE)
ON CONFLICT (key) DO UPDATE
SET label=EXCLUDED.label,
    description=EXCLUDED.description,
    enabled=TRUE,
    updated_at=NOW();

WITH seed AS (
  SELECT value AS item
  FROM jsonb_array_elements(
$keybinds$
[
  {
    "resource": "1of1VehicleProgram",
    "title": "Voden CH-47D Keybinds",
    "body": "These are the registered default or fallback controls for **Voden CH-47D** on Saucin RP.\n\n- **G** — Voden CH-47D: Toggle Engine.\n\nThese controls are rebindable. If a key does not match your setup, open **GTA V Settings → Key Bindings → FiveM** and search for the action name.\n\nSource resource: `1of1VehicleProgram`. Imported from the high-confidence Saucin resource scan generated September 3, 2026.",
    "audiences": [
      "public"
    ],
    "aliases": [
      "1of1VehicleProgram",
      "Voden CH-47D",
      "Voden CH-47D controls",
      "Voden CH-47D keybinds",
      "Voden CH-47D: Toggle Engine",
      "+voden_ch47d_engine",
      "G"
    ],
    "related_topics": [
      "keybinds",
      "controls",
      "FiveM key bindings",
      "1of1VehicleProgram",
      "vehicles",
      "Voden CH-47D"
    ],
    "example_questions": [
      "What are the default Voden CH-47D keybinds?",
      "What key is used for Toggle Engine?"
    ]
  },
  {
    "resource": "county-tow",
    "title": "County Tow Keybinds",
    "body": "These are the registered default or fallback controls for **County Tow** on Saucin RP.\n\n- **H** — County Tow: complete delivery.\n- **G** — County Tow: GTA tow hook attach/detach.\n- **F7** — County Tow: hide/show tow meter.\n- **F6** — County Tow: interact with tow meter.\n- **U** — County Tow: mark vehicle too large.\n\nThese controls are rebindable. If a key does not match your setup, open **GTA V Settings → Key Bindings → FiveM** and search for the action name.\n\nSource resource: `county-tow`. Imported from the high-confidence Saucin resource scan generated September 3, 2026.",
    "audiences": [
      "public"
    ],
    "aliases": [
      "county-tow",
      "County Tow",
      "County Tow controls",
      "County Tow keybinds",
      "County Tow: complete delivery",
      "+countyTowHudComplete",
      "H",
      "County Tow: GTA tow hook attach/detach",
      "+countyTowNativeHook",
      "G",
      "County Tow: hide/show tow meter",
      "+countyTowHudToggle",
      "F7",
      "County Tow: interact with tow meter",
      "+countyTowHudInteract",
      "F6",
      "County Tow: mark vehicle too large",
      "+countyTowHudTooLarge",
      "U"
    ],
    "related_topics": [
      "keybinds",
      "controls",
      "FiveM key bindings",
      "county-tow",
      "Saucin",
      "County Tow"
    ],
    "example_questions": [
      "What are the default County Tow keybinds?",
      "What key is used for complete delivery?",
      "What key is used for GTA tow hook attach/detach?",
      "What key is used for hide/show tow meter?",
      "What key is used for interact with tow meter?",
      "What key is used for mark vehicle too large?"
    ]
  },
  {
    "resource": "cylex_animmenuv2",
    "title": "Emotes Keybinds",
    "body": "These are the registered default or fallback controls for **Emotes** on Saucin RP.\n\n- **X** — Emote Cancel.\n- **Left Shift** — Emote Shortcut Bind.\n- **B** — Open Emote Wheel.\n\nThese controls are rebindable. If a key does not match your setup, open **GTA V Settings → Key Bindings → FiveM** and search for the action name.\n\nSource resource: `cylex_animmenuv2`. Imported from the high-confidence Saucin resource scan generated September 3, 2026.",
    "audiences": [
      "public"
    ],
    "aliases": [
      "cylex_animmenuv2",
      "Emotes",
      "Emotes controls",
      "Emotes keybinds",
      "Emote Cancel",
      "emotecancel",
      "X",
      "Emote Shortcut Bind",
      "+emote_shortcuts",
      "Left Shift",
      "LSHIFT",
      "Open Emote Wheel",
      "+openEmoteWheel",
      "B"
    ],
    "related_topics": [
      "keybinds",
      "controls",
      "FiveM key bindings",
      "cylex_animmenuv2",
      "standalone",
      "Emotes"
    ],
    "example_questions": [
      "What are the default Emotes keybinds?",
      "What key is used for Emote Cancel?",
      "What key is used for Emote Shortcut Bind?",
      "What key is used for Open Emote Wheel?"
    ]
  },
  {
    "resource": "ebu_boattrailer",
    "title": "Boat Trailer Keybinds",
    "body": "These are the registered default or fallback controls for **Boat Trailer** on Saucin RP.\n\n- **G** — Attach/Detach Boat (inside).\n- **F** — Get In Boat (outside).\n- **B** — Toggle Anchor.\n\nThese controls are rebindable. If a key does not match your setup, open **GTA V Settings → Key Bindings → FiveM** and search for the action name.\n\nSource resource: `ebu_boattrailer`. Imported from the high-confidence Saucin resource scan generated September 3, 2026.",
    "audiences": [
      "public"
    ],
    "aliases": [
      "ebu_boattrailer",
      "Boat Trailer",
      "Boat Trailer controls",
      "Boat Trailer keybinds",
      "Attach/Detach Boat (inside)",
      "+boatAttachn",
      "G",
      "g",
      "Get In Boat (outside)",
      "+boatWarpn",
      "F",
      "f",
      "Toggle Anchor",
      "+boanchor",
      "B"
    ],
    "related_topics": [
      "keybinds",
      "controls",
      "FiveM key bindings",
      "ebu_boattrailer",
      "VehicleTools",
      "Boat Trailer"
    ],
    "example_questions": [
      "What are the default Boat Trailer keybinds?",
      "What key is used for Attach/Detach Boat (inside)?",
      "What key is used for Get In Boat (outside)?",
      "What key is used for Toggle Anchor?"
    ]
  },
  {
    "resource": "ebu_c3brush",
    "title": "Fire Brush Truck Keybinds",
    "body": "These are the registered default or fallback controls for **Fire Brush Truck** on Saucin RP.\n\n- **9** — Toggle Sounds.\n- **0** — Toggle Water.\n\nThese controls are rebindable. If a key does not match your setup, open **GTA V Settings → Key Bindings → FiveM** and search for the action name.\n\nSource resource: `ebu_c3brush`. Imported from the high-confidence Saucin resource scan generated September 3, 2026.",
    "audiences": [
      "ems",
      "staff"
    ],
    "aliases": [
      "ebu_c3brush",
      "Fire Brush Truck",
      "Fire Brush Truck controls",
      "Fire Brush Truck keybinds",
      "Toggle Sounds",
      "+bruSou",
      "9",
      "Toggle Water",
      "+bruTog",
      "0"
    ],
    "related_topics": [
      "keybinds",
      "controls",
      "FiveM key bindings",
      "ebu_c3brush",
      "SAFR",
      "Fire Brush Truck"
    ],
    "example_questions": [
      "What are the default Fire Brush Truck keybinds?",
      "What key is used for Toggle Sounds?",
      "What key is used for Toggle Water?"
    ]
  },
  {
    "resource": "ebu_connect",
    "title": "Trailer Connection Keybinds",
    "body": "These are the registered default or fallback controls for **Trailer Connection** on Saucin RP.\n\n- **H** — Connect any trailer.\n\nThese controls are rebindable. If a key does not match your setup, open **GTA V Settings → Key Bindings → FiveM** and search for the action name.\n\nSource resource: `ebu_connect`. Imported from the high-confidence Saucin resource scan generated September 3, 2026.",
    "audiences": [
      "public"
    ],
    "aliases": [
      "ebu_connect",
      "Trailer Connection",
      "Trailer Connection controls",
      "Trailer Connection keybinds",
      "Connect any trailer",
      "+trailerConnect",
      "H",
      "h"
    ],
    "related_topics": [
      "keybinds",
      "controls",
      "FiveM key bindings",
      "ebu_connect",
      "VehicleTools",
      "Trailer Connection"
    ],
    "example_questions": [
      "What are the default Trailer Connection keybinds?",
      "What key is used for Connect any trailer?"
    ]
  },
  {
    "resource": "ebu_flatbeds",
    "title": "Flatbed Keybinds",
    "body": "These are the registered default or fallback controls for **Flatbed** on Saucin RP.\n\n- **F** — Flatbed Get In Car.\n\nThese controls are rebindable. If a key does not match your setup, open **GTA V Settings → Key Bindings → FiveM** and search for the action name.\n\nSource resource: `ebu_flatbeds`. Imported from the high-confidence Saucin resource scan generated September 3, 2026.",
    "audiences": [
      "public"
    ],
    "aliases": [
      "ebu_flatbeds",
      "Flatbed",
      "Flatbed controls",
      "Flatbed keybinds",
      "Flatbed Get In Car",
      "+flatbedWarp",
      "F"
    ],
    "related_topics": [
      "keybinds",
      "controls",
      "FiveM key bindings",
      "ebu_flatbeds",
      "DOT",
      "Flatbed"
    ],
    "example_questions": [
      "What are the default Flatbed keybinds?",
      "What key is used for Flatbed Get In Car?"
    ]
  },
  {
    "resource": "ebu_multilevel",
    "title": "Multi-Level Trailer Keybinds",
    "body": "These are the registered default or fallback controls for **Multi-Level Trailer** on Saucin RP.\n\n- **J** — Connect any trailer.\n- **F** — Get in attached vehicle.\n\nThese controls are rebindable. If a key does not match your setup, open **GTA V Settings → Key Bindings → FiveM** and search for the action name.\n\nSource resource: `ebu_multilevel`. Imported from the high-confidence Saucin resource scan generated September 3, 2026.",
    "audiences": [
      "public"
    ],
    "aliases": [
      "ebu_multilevel",
      "Multi-Level Trailer",
      "Multi-Level Trailer controls",
      "Multi-Level Trailer keybinds",
      "Connect any trailer",
      "+mltrlConnect",
      "J",
      "j",
      "Get in attached vehicle",
      "+mltrlWarp",
      "F",
      "f"
    ],
    "related_topics": [
      "keybinds",
      "controls",
      "FiveM key bindings",
      "ebu_multilevel",
      "VehicleTools",
      "Multi-Level Trailer"
    ],
    "example_questions": [
      "What are the default Multi-Level Trailer keybinds?",
      "What key is used for Connect any trailer?",
      "What key is used for Get in attached vehicle?"
    ]
  },
  {
    "resource": "ebu_trailer",
    "title": "Vehicle Trailer Keybinds",
    "body": "These are the registered default or fallback controls for **Vehicle Trailer** on Saucin RP.\n\n- **J** — Connect any trailer.\n- **F** — Get in attached vehicle.\n\nThese controls are rebindable. If a key does not match your setup, open **GTA V Settings → Key Bindings → FiveM** and search for the action name.\n\nSource resource: `ebu_trailer`. Imported from the high-confidence Saucin resource scan generated September 3, 2026.",
    "audiences": [
      "public"
    ],
    "aliases": [
      "ebu_trailer",
      "Vehicle Trailer",
      "Vehicle Trailer controls",
      "Vehicle Trailer keybinds",
      "Connect any trailer",
      "+trailerConnect",
      "J",
      "j",
      "Get in attached vehicle",
      "+trailerWarp",
      "F",
      "f"
    ],
    "related_topics": [
      "keybinds",
      "controls",
      "FiveM key bindings",
      "ebu_trailer",
      "VehicleTools",
      "Vehicle Trailer"
    ],
    "example_questions": [
      "What are the default Vehicle Trailer keybinds?",
      "What key is used for Connect any trailer?",
      "What key is used for Get in attached vehicle?"
    ]
  },
  {
    "resource": "envi-interact",
    "title": "Interaction Keybinds",
    "body": "These are the registered default or fallback controls for **Interaction** on Saucin RP.\n\n- **E** — Interact.\n- **Mouse Wheel Down** — Scroll Down.\n- **Mouse Wheel Up** — Scroll Up.\n\nThese controls are rebindable. If a key does not match your setup, open **GTA V Settings → Key Bindings → FiveM** and search for the action name.\n\nSource resource: `envi-interact`. Imported from the high-confidence Saucin resource scan generated September 3, 2026.",
    "audiences": [
      "public"
    ],
    "aliases": [
      "envi-interact",
      "Interaction",
      "Interaction controls",
      "Interaction keybinds",
      "Envi-Interact - Interact",
      "interact",
      "E",
      "Envi-Interact - Scroll Down",
      "+scrollDown",
      "Mouse Wheel Down",
      "IOM_WHEEL_DOWN",
      "Envi-Interact - Scroll Up",
      "+scrollUp",
      "Mouse Wheel Up",
      "IOM_WHEEL_UP"
    ],
    "related_topics": [
      "keybinds",
      "controls",
      "FiveM key bindings",
      "envi-interact",
      "Envi",
      "Interaction"
    ],
    "example_questions": [
      "What are the default Interaction keybinds?",
      "What key is used for Envi-Interact - Interact?",
      "What key is used for Envi-Interact - Scroll Down?",
      "What key is used for Envi-Interact - Scroll Up?"
    ]
  },
  {
    "resource": "jg-hud",
    "title": "Vehicle Seatbelt Keybinds",
    "body": "These are the registered default or fallback controls for **Vehicle Seatbelt** on Saucin RP.\n\n- **B** — Toggle vehicle seatbelt.\n\nThese controls are rebindable. If a key does not match your setup, open **GTA V Settings → Key Bindings → FiveM** and search for the action name.\n\nSource resource: `jg-hud`. Imported from the high-confidence Saucin resource scan generated September 3, 2026.",
    "audiences": [
      "public"
    ],
    "aliases": [
      "jg-hud",
      "Vehicle Seatbelt",
      "Vehicle Seatbelt controls",
      "Vehicle Seatbelt keybinds",
      "Toggle vehicle seatbelt",
      "toggle_seatbelt",
      "B"
    ],
    "related_topics": [
      "keybinds",
      "controls",
      "FiveM key bindings",
      "jg-hud",
      "JG",
      "Vehicle Seatbelt"
    ],
    "example_questions": [
      "What are the default Vehicle Seatbelt keybinds?",
      "What key is used for Toggle vehicle seatbelt?"
    ]
  },
  {
    "resource": "k_cams",
    "title": "Police Body Camera Keybinds",
    "body": "These are the registered default or fallback controls for **Police Body Camera** on Saucin RP.\n\n- **E** — Toggle Recording.\n\nThese controls are rebindable. If a key does not match your setup, open **GTA V Settings → Key Bindings → FiveM** and search for the action name.\n\nSource resource: `k_cams`. Imported from the high-confidence Saucin resource scan generated September 3, 2026.",
    "audiences": [
      "leo",
      "staff"
    ],
    "aliases": [
      "k_cams",
      "Police Body Camera",
      "Police Body Camera controls",
      "Police Body Camera keybinds",
      "Toggle Recording",
      "toggleRecording",
      "E",
      "e"
    ],
    "related_topics": [
      "keybinds",
      "controls",
      "FiveM key bindings",
      "k_cams",
      "Police",
      "Police Body Camera"
    ],
    "example_questions": [
      "What are the default Police Body Camera keybinds?",
      "What key is used for Toggle Recording?"
    ]
  },
  {
    "resource": "kingkefa_suspension",
    "title": "Air Suspension Keybinds",
    "body": "These are the registered default or fallback controls for **Air Suspension** on Saucin RP.\n\n- **U** — Open the air suspension controller.\n\nThese controls are rebindable. If a key does not match your setup, open **GTA V Settings → Key Bindings → FiveM** and search for the action name.\n\nSource resource: `kingkefa_suspension`. Imported from the high-confidence Saucin resource scan generated September 3, 2026.",
    "audiences": [
      "public"
    ],
    "aliases": [
      "kingkefa_suspension",
      "Air Suspension",
      "Air Suspension controls",
      "Air Suspension keybinds",
      "Open the air suspension controller",
      "+saucinAirRide",
      "U"
    ],
    "related_topics": [
      "keybinds",
      "controls",
      "FiveM key bindings",
      "kingkefa_suspension",
      "VehicleTools",
      "Air Suspension"
    ],
    "example_questions": [
      "What are the default Air Suspension keybinds?",
      "What key is used for Open the air suspension controller?"
    ]
  },
  {
    "resource": "op-crime",
    "title": "Hands Up Keybinds",
    "body": "These are the registered default or fallback controls for **Hands Up** on Saucin RP.\n\n- **X** — Hands Up.\n\nThese controls are rebindable. If a key does not match your setup, open **GTA V Settings → Key Bindings → FiveM** and search for the action name.\n\nSource resource: `op-crime`. Imported from the high-confidence Saucin resource scan generated September 3, 2026.",
    "audiences": [
      "public"
    ],
    "aliases": [
      "op-crime",
      "Hands Up",
      "Hands Up controls",
      "Hands Up keybinds",
      "handsup",
      "X"
    ],
    "related_topics": [
      "keybinds",
      "controls",
      "FiveM key bindings",
      "op-crime",
      "Criminal",
      "Hands Up"
    ],
    "example_questions": [
      "What are the default Hands Up keybinds?",
      "What key is used for Hands Up?"
    ]
  },
  {
    "resource": "pma-voice",
    "title": "Voice & Radio Keybinds",
    "body": "These are the registered default or fallback controls for **Voice & Radio** on Saucin RP.\n\n- **Z** — Change the global radio key.\n- **F11** — Cycle Proximity.\n- **Left Alt** — Talk over Radio.\n\nThese controls are rebindable. If a key does not match your setup, open **GTA V Settings → Key Bindings → FiveM** and search for the action name.\n\nSource resource: `pma-voice`. Imported from the high-confidence Saucin resource scan generated September 3, 2026.",
    "audiences": [
      "public"
    ],
    "aliases": [
      "pma-voice",
      "Voice & Radio",
      "Voice & Radio controls",
      "Voice & Radio keybinds",
      "Change the global radio key",
      "+radioglobaltalk",
      "Z",
      "Cycle Proximity",
      "cycleproximity",
      "F11",
      "Talk over Radio",
      "+radiotalk",
      "Left Alt",
      "LMENU"
    ],
    "related_topics": [
      "keybinds",
      "controls",
      "FiveM key bindings",
      "pma-voice",
      "voice",
      "Voice & Radio"
    ],
    "example_questions": [
      "What are the default Voice & Radio keybinds?",
      "What key is used for Change the global radio key?",
      "What key is used for Cycle Proximity?",
      "What key is used for Talk over Radio?"
    ]
  },
  {
    "resource": "qb-menu",
    "title": "Menu Focus Keybinds",
    "body": "These are the registered default or fallback controls for **Menu Focus** on Saucin RP.\n\n- **Left Alt** — Give Menu Focus.\n\nThese controls are rebindable. If a key does not match your setup, open **GTA V Settings → Key Bindings → FiveM** and search for the action name.\n\nSource resource: `qb-menu`. Imported from the high-confidence Saucin resource scan generated September 3, 2026.",
    "audiences": [
      "public"
    ],
    "aliases": [
      "qb-menu",
      "Menu Focus",
      "Menu Focus controls",
      "Menu Focus keybinds",
      "Give Menu Focus",
      "playerFocus",
      "Left Alt",
      "LMENU"
    ],
    "related_topics": [
      "keybinds",
      "controls",
      "FiveM key bindings",
      "qb-menu",
      "standalone",
      "Menu Focus"
    ],
    "example_questions": [
      "What are the default Menu Focus keybinds?",
      "What key is used for Give Menu Focus?"
    ]
  },
  {
    "resource": "rcore_dispatch",
    "title": "Dispatch Keybinds",
    "body": "These are the registered default or fallback controls for **Dispatch** on Saucin RP.\n\n- **Up Arrow** — Dispatch delete alert.\n- **Right Arrow** — Dispatch next alert.\n- **Left Arrow** — Dispatch previous alert.\n- **Down Arrow** — Dispatch select alert.\n- **F10** — Open switchboard configuration.\n\nThese controls are rebindable. If a key does not match your setup, open **GTA V Settings → Key Bindings → FiveM** and search for the action name.\n\nSource resource: `rcore_dispatch`. Imported from the high-confidence Saucin resource scan generated September 3, 2026.",
    "audiences": [
      "leo",
      "ems",
      "staff"
    ],
    "aliases": [
      "rcore_dispatch",
      "Dispatch",
      "Dispatch controls",
      "Dispatch keybinds",
      "Dispatch delete alert",
      "dispatch_delete_alert",
      "Up Arrow",
      "UP",
      "Dispatch next alert",
      "dispatch_next_alert",
      "Right Arrow",
      "RIGHT",
      "Dispatch previous alert",
      "dispatch_previous_alert",
      "Left Arrow",
      "LEFT",
      "Dispatch select alert",
      "dispatch_select_alert",
      "Down Arrow",
      "DOWN",
      "Open switchboard configuration",
      "CL_CONFIG.UtilityCommands['switchboard_config'].command",
      "F10",
      "f10"
    ],
    "related_topics": [
      "keybinds",
      "controls",
      "FiveM key bindings",
      "rcore_dispatch",
      "Other",
      "Dispatch"
    ],
    "example_questions": [
      "What are the default Dispatch keybinds?",
      "What key is used for Dispatch delete alert?",
      "What key is used for Dispatch next alert?",
      "What key is used for Dispatch previous alert?",
      "What key is used for Dispatch select alert?",
      "What key is used for Open switchboard configuration?"
    ]
  },
  {
    "resource": "saucin-scoreboard",
    "title": "Scoreboard Keybinds",
    "body": "These are the registered default or fallback controls for **Scoreboard** on Saucin RP.\n\n- **HOME** — Saucin Scoreboard.\n- **Middle Mouse** — Saucin Scoreboard (Middle Mouse).\n\nThese controls are rebindable. If a key does not match your setup, open **GTA V Settings → Key Bindings → FiveM** and search for the action name.\n\nSource resource: `saucin-scoreboard`. Imported from the high-confidence Saucin resource scan generated September 3, 2026.",
    "audiences": [
      "public"
    ],
    "aliases": [
      "saucin-scoreboard",
      "Scoreboard",
      "Scoreboard controls",
      "Scoreboard keybinds",
      "Saucin Scoreboard",
      "+saucin_scoreboard",
      "HOME",
      "Saucin Scoreboard (Middle Mouse)",
      "+saucin_scoreboard_mouse",
      "Middle Mouse",
      "MOUSE_MIDDLE"
    ],
    "related_topics": [
      "keybinds",
      "controls",
      "FiveM key bindings",
      "saucin-scoreboard",
      "Saucin",
      "Scoreboard"
    ],
    "example_questions": [
      "What are the default Scoreboard keybinds?",
      "What key is used for Saucin Scoreboard?",
      "What key is used for Saucin Scoreboard (Middle Mouse)?"
    ]
  },
  {
    "resource": "saucin-welder",
    "title": "VIP Welding Keybinds",
    "body": "These are the registered default or fallback controls for **VIP Welding** on Saucin RP.\n\n- **F6** — Open the VIP welding career tablet.\n\nThese controls are rebindable. If a key does not match your setup, open **GTA V Settings → Key Bindings → FiveM** and search for the action name.\n\nSource resource: `saucin-welder`. Imported from the high-confidence Saucin resource scan generated September 3, 2026.",
    "audiences": [
      "public"
    ],
    "aliases": [
      "saucin-welder",
      "VIP Welding",
      "VIP Welding controls",
      "VIP Welding keybinds",
      "Open the VIP welding career tablet",
      "Config.Command",
      "F6"
    ],
    "related_topics": [
      "keybinds",
      "controls",
      "FiveM key bindings",
      "saucin-welder",
      "Saucin",
      "VIP Welding"
    ],
    "example_questions": [
      "What are the default VIP Welding keybinds?",
      "What key is used for Open the VIP welding career tablet?"
    ]
  },
  {
    "resource": "saucin-whitewidow",
    "title": "White Widow Interface Keybinds",
    "body": "These are the registered default or fallback controls for **White Widow Interface** on Saucin RP.\n\n- **F10** — Close a stuck White Widow interface.\n\nThese controls are rebindable. If a key does not match your setup, open **GTA V Settings → Key Bindings → FiveM** and search for the action name.\n\nSource resource: `saucin-whitewidow`. Imported from the high-confidence Saucin resource scan generated September 3, 2026.",
    "audiences": [
      "public"
    ],
    "aliases": [
      "saucin-whitewidow",
      "White Widow Interface",
      "White Widow Interface controls",
      "White Widow Interface keybinds",
      "Close a stuck White Widow interface",
      "wwclose",
      "F10"
    ],
    "related_topics": [
      "keybinds",
      "controls",
      "FiveM key bindings",
      "saucin-whitewidow",
      "Saucin",
      "White Widow Interface"
    ],
    "example_questions": [
      "What are the default White Widow Interface keybinds?",
      "What key is used for Close a stuck White Widow interface?"
    ]
  },
  {
    "resource": "saucin_upvotes",
    "title": "Community Support Keybinds",
    "body": "These are the registered default or fallback controls for **Community Support** on Saucin RP.\n\n- **Esc** — Close Saucin Community Support.\n\nThese controls are rebindable. If a key does not match your setup, open **GTA V Settings → Key Bindings → FiveM** and search for the action name.\n\nSource resource: `saucin_upvotes`. Imported from the high-confidence Saucin resource scan generated September 3, 2026.",
    "audiences": [
      "public"
    ],
    "aliases": [
      "saucin_upvotes",
      "Community Support",
      "Community Support controls",
      "Community Support keybinds",
      "Close Saucin Community Support",
      "('saucin_%s_close'):format(Config.Command)",
      "Esc",
      "ESCAPE"
    ],
    "related_topics": [
      "keybinds",
      "controls",
      "FiveM key bindings",
      "saucin_upvotes",
      "Saucin",
      "Community Support"
    ],
    "example_questions": [
      "What are the default Community Support keybinds?",
      "What key is used for Close Saucin Community Support?"
    ]
  },
  {
    "resource": "ulc",
    "title": "Emergency Lights (ULC) Keybinds",
    "body": "These are the registered default or fallback controls for **Emergency Lights (ULC)** on Saucin RP.\n\n- **Q** — Toggle Emergency Lights.\n- **S** — ULC: Activate Brake Pattern (Hold).\n- **E** — ULC: Activate Horn Extras.\n- **Numpad 0** — ULC: Cycle Stages.\n- **Numpad -** — ULC: Stage Down.\n- **Numpad +** — ULC: Stage Up.\n\nThese controls are rebindable. If a key does not match your setup, open **GTA V Settings → Key Bindings → FiveM** and search for the action name.\n\nSource resource: `ulc`. Imported from the high-confidence Saucin resource scan generated September 3, 2026.",
    "audiences": [
      "leo",
      "staff"
    ],
    "aliases": [
      "ulc",
      "Emergency Lights (ULC)",
      "Emergency Lights (ULC) controls",
      "Emergency Lights (ULC) keybinds",
      "Toggle Emergency Lights",
      "ulc:toggleLights",
      "Q",
      "q",
      "ULC: Activate Brake Pattern (Hold)",
      "+ulc:brakePattern",
      "S",
      "s",
      "ULC: Activate Horn Extras",
      "+ulc:horn",
      "E",
      "e",
      "ULC: Cycle Stages",
      "ulc:stage_cycle",
      "Numpad 0",
      "NUMPAD0",
      "ULC: Stage Down",
      "ulc:stage_down",
      "Numpad -",
      "SUBTRACT",
      "ULC: Stage Up",
      "ulc:stage_up",
      "Numpad +",
      "ADD"
    ],
    "related_topics": [
      "keybinds",
      "controls",
      "FiveM key bindings",
      "ulc",
      "Police_Addons",
      "Emergency Lights (ULC)"
    ],
    "example_questions": [
      "What are the default Emergency Lights (ULC) keybinds?",
      "What key is used for Toggle Emergency Lights?",
      "What key is used for Activate Brake Pattern (Hold)?",
      "What key is used for Activate Horn Extras?",
      "What key is used for Cycle Stages?",
      "What key is used for Stage Down?",
      "What key is used for Stage Up?"
    ]
  },
  {
    "resource": "Winch",
    "title": "Winch Keybinds",
    "body": "These are the registered default or fallback controls for **Winch** on Saucin RP.\n\n- **Left Shift** — All.\n- **B** — Break.\n- **E** — Menu.\n- **Right Arrow** — Next.\n- **Left Arrow** — Previous.\n- **Left Alt** — Secondary.\n- **Left Mouse** — Select.\n\nThese controls are rebindable. If a key does not match your setup, open **GTA V Settings → Key Bindings → FiveM** and search for the action name.\n\nSource resource: `Winch`. Imported from the high-confidence Saucin resource scan generated September 3, 2026.",
    "audiences": [
      "public"
    ],
    "aliases": [
      "Winch",
      "Winch controls",
      "Winch keybinds",
      "Winch - All",
      "+winch_all",
      "Left Shift",
      "LSHIFT",
      "Winch - Break",
      "+winch_break",
      "B",
      "Winch - Menu",
      "+winch_start",
      "E",
      "Winch - Next",
      "+winch_next",
      "Right Arrow",
      "RIGHT",
      "Winch - Previous",
      "+winch_prev",
      "Left Arrow",
      "LEFT",
      "Winch - Secondary",
      "+winch_secon",
      "Left Alt",
      "LMENU",
      "Winch - Select",
      "+winch_select",
      "Left Mouse",
      "MOUSE_LEFT"
    ],
    "related_topics": [
      "keybinds",
      "controls",
      "FiveM key bindings",
      "Winch",
      "standalone"
    ],
    "example_questions": [
      "What are the default Winch keybinds?",
      "What key is used for Winch - All?",
      "What key is used for Winch - Break?",
      "What key is used for Winch - Menu?",
      "What key is used for Winch - Next?",
      "What key is used for Winch - Previous?",
      "What key is used for Winch - Secondary?",
      "What key is used for Winch - Select?"
    ]
  }
]
$keybinds$::jsonb
  )
)
INSERT INTO knowledge_articles
  (title,body,content_type,category,audience,audiences,status,source_url,aliases,related_topics,example_questions,created_by)
SELECT
  item->>'title',
  item->>'body',
  'reference',
  'keybinds',
  item->'audiences'->>0,
  ARRAY(SELECT jsonb_array_elements_text(item->'audiences')),
  'published',
  NULL,
  ARRAY(SELECT jsonb_array_elements_text(item->'aliases')),
  ARRAY(SELECT jsonb_array_elements_text(item->'related_topics')),
  ARRAY(SELECT jsonb_array_elements_text(item->'example_questions')),
  'Saucin resource scan · 2026-09-03'
FROM seed
WHERE NOT EXISTS (
  SELECT 1
  FROM knowledge_articles existing
  WHERE existing.created_by='Saucin resource scan · 2026-09-03'
    AND existing.title=item->>'title'
);
