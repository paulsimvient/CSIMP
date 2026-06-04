import uavDroneUrl from "../../../wargame_icon_pack/svg/uav_drone.svg?url";
import fighterJetUrl from "../../../wargame_icon_pack/svg/fighter_jet.svg?url";
import strikeAircraftUrl from "../../../wargame_icon_pack/svg/strike_aircraft.svg?url";
import surfaceWarshipUrl from "../../../wargame_icon_pack/svg/surface_warship.svg?url";
import missileBoatUrl from "../../../wargame_icon_pack/svg/missile_boat.svg?url";
import submarineUrl from "../../../wargame_icon_pack/svg/submarine.svg?url";
import radarUrl from "../../../wargame_icon_pack/svg/radar.svg?url";
import passiveSensorUrl from "../../../wargame_icon_pack/svg/passive_sensor.svg?url";
import cyberAttackUrl from "../../../wargame_icon_pack/svg/cyber_attack.svg?url";
import commandNodeUrl from "../../../wargame_icon_pack/svg/command_node.svg?url";
import logisticsDepotUrl from "../../../wargame_icon_pack/svg/logistics_depot.svg?url";
import satelliteUrl from "../../../wargame_icon_pack/svg/satellite.svg?url";
import civilianMarkerUrl from "../../../wargame_icon_pack/svg/civilian_marker.svg?url";
import missileInboundUrl from "../../../wargame_icon_pack/svg/missile_inbound.svg?url";
import unknownContactUrl from "../../../wargame_icon_pack/svg/unknown_contact.svg?url";

/** Bundled wargame icon asset URLs — always included in production builds. */
export const WARGAME_ICON_URLS = {
  uav_drone: uavDroneUrl,
  fighter_jet: fighterJetUrl,
  strike_aircraft: strikeAircraftUrl,
  surface_warship: surfaceWarshipUrl,
  missile_boat: missileBoatUrl,
  submarine: submarineUrl,
  radar: radarUrl,
  passive_sensor: passiveSensorUrl,
  cyber_attack: cyberAttackUrl,
  command_node: commandNodeUrl,
  logistics_depot: logisticsDepotUrl,
  satellite: satelliteUrl,
  civilian_marker: civilianMarkerUrl,
  missile_inbound: missileInboundUrl,
  unknown_contact: unknownContactUrl,
} as const;

export type WargameIconKey = keyof typeof WARGAME_ICON_URLS;
