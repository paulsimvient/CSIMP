import { describe, expect, it } from "vitest";
import {
  buildSceneObjectOptions,
  classifyFactAffiliation,
  classifyTrackAffiliation,
  filterSceneOptions,
  groupSceneOptions,
  isSceneOptionSelectable,
  resolveOptionMapFactId,
  scenePickRejectMessage,
  sceneSelectionComposerRole,
  findSceneOptionForFactId,
} from "./sceneObjects";
import type { ObservedFact } from "../../intel/types";
import type { OverviewTrack } from "./types";

const friendlyFact: ObservedFact = {
  id: "fact-friendly",
  time: "08:00",
  domain: "ground",
  entity: "1-42 Infantry",
  event: "Hold position",
  severity: "low",
  confidence: "high",
  source: "SITREP",
};

const infrastructureFact: ObservedFact = {
  id: "fact-relay",
  time: "06:41",
  domain: "ground",
  entity: "Coastal communications relay",
  event: "Relay node experienced rolling outage and fallback comms activation",
  severity: "medium",
  confidence: "high",
  source: "Signals regiment maintenance channel",
};

const informationFact: ObservedFact = {
  id: "fact_info_001",
  time: "06:14",
  domain: "information",
  entity: "Regional civilian channels",
  event: "False evacuation advisories spreading via mirrored social accounts",
  severity: "medium",
  confidence: "medium",
  source: "Open-source narrative watch desk",
};

const threatFact: ObservedFact = {
  id: "fact-threat",
  time: "08:05",
  domain: "UAS",
  entity: "Hostile drone swarm",
  event: "Inbound track",
  severity: "critical",
  confidence: "medium",
  source: "RADAR",
};

const unknownTrack: OverviewTrack = {
  id: "track-unknown",
  callsign: "UNKNOWN-12",
  side: "unknown",
  classification: "unknown-air",
  confidence: 0.4,
  uncertaintyMeters: 120,
  stalenessMinutes: 3,
  stalenessState: "fresh",
  detectedBy: "RADAR",
  lastUpdate: "08:02",
  summary: "Unidentified contact",
  history: [],
};

const hostileTrack: OverviewTrack = {
  ...unknownTrack,
  id: "track-hostile",
  callsign: "THREAT-7",
  side: "hostile",
};

describe("scene object controllable filtering", () => {
  it("classifies map symbology affiliations", () => {
    expect(classifyFactAffiliation(friendlyFact)).toBe("controllable");
    expect(classifyFactAffiliation(threatFact)).toBe("threat");
    expect(classifyTrackAffiliation(unknownTrack)).toBe("unknown");
    expect(classifyTrackAffiliation(hostileTrack)).toBe("threat");
  });

  it("limits acting-unit pickers to map contacts and known assets only", () => {
    const options = buildSceneObjectOptions({
      facts: [friendlyFact, infrastructureFact, threatFact],
      tracks: [unknownTrack, hostileTrack],
      knownAssets: ["surface-escort-group-alpha"],
    });

    const actorOptions = filterSceneOptions(options, ["contact", "asset"], "controllable");

    expect(actorOptions.some((opt) => opt.id === "track:track-hostile")).toBe(false);
    expect(actorOptions.some((opt) => opt.id === "fact:fact-relay")).toBe(false);
    expect(actorOptions.some((opt) => opt.id === "fact:fact-friendly")).toBe(false);
    expect(actorOptions.some((opt) => opt.id === "track:track-unknown")).toBe(true);
    expect(actorOptions.some((opt) => opt.id === "asset:surface-escort-group-alpha")).toBe(true);
  });

  it("allows infrastructure and threat facts as objectives", () => {
    const options = buildSceneObjectOptions({
      facts: [infrastructureFact, threatFact],
      tracks: [hostileTrack],
    });

    const targetOptions = filterSceneOptions(options, ["fact", "contact", "task"], "objective");
    expect(targetOptions.some((opt) => opt.id === "fact:fact-relay")).toBe(true);
    expect(targetOptions.some((opt) => opt.id === "track:track-hostile")).toBe(true);
    expect(targetOptions.some((opt) => opt.id === "fact:fact-threat")).toBe(true);
  });

  it("explains why information objectives cannot be acting units", () => {
    const options = buildSceneObjectOptions({ facts: [informationFact], tracks: [] });
    const infoOption = options.find((opt) => opt.id === "fact:fact_info_001");
    expect(infoOption).toBeDefined();
    expect(isSceneOptionSelectable(infoOption!, "controllable", ["contact", "asset"])).toBe(
      false
    );
    expect(isSceneOptionSelectable(infoOption!, "objective", ["fact", "contact", "task"])).toBe(
      true
    );
    expect(scenePickRejectMessage(infoOption!, "controllable", ["contact", "asset"])).toContain(
      "Target"
    );
  });

  it("allows grey unknown contacts as actors but blocks information objectives", () => {
    const maritimeFact: ObservedFact = {
      id: "fact-mar",
      time: "06:24",
      domain: "maritime",
      entity: "Militia-like vessel group",
      event: "Erratic crossing",
      severity: "medium",
      confidence: "high",
      source: "Patrol",
    };
    const options = buildSceneObjectOptions({
      facts: [maritimeFact, informationFact],
      tracks: [
        {
          id: "fact-mar",
          callsign: "MAR · Militia-like",
          side: "unknown",
          classification: "unknown-air",
          confidence: 0.7,
          uncertaintyMeters: 100,
          stalenessMinutes: 5,
          stalenessState: "fresh",
          detectedBy: "Patrol",
          lastUpdate: "06:24",
          summary: "Erratic crossing",
          history: [],
        },
        {
          id: "fact_info_001",
          callsign: "INFO · Regional",
          side: "unknown",
          classification: "unknown-air",
          confidence: 0.6,
          uncertaintyMeters: 100,
          stalenessMinutes: 5,
          stalenessState: "fresh",
          detectedBy: "OSINT",
          lastUpdate: "06:14",
          summary: "False evacuation",
          history: [],
        },
      ],
    });
    const marContact = options.find((opt) => opt.id === "track:fact-mar");
    const infoContact = options.find((opt) => opt.id === "track:fact_info_001");
    expect(isSceneOptionSelectable(marContact!, "controllable", ["contact", "asset"])).toBe(
      true
    );
    expect(isSceneOptionSelectable(infoContact!, "controllable", ["contact", "asset"])).toBe(
      false
    );
  });

  it("rejects threat map picks for controllable fields", () => {
    const threatOption = buildSceneObjectOptions({
      facts: [threatFact],
      tracks: [hostileTrack],
    }).find((opt) => opt.id === "track:track-hostile");

    expect(threatOption).toBeDefined();
    expect(isSceneOptionSelectable(threatOption!, "controllable", ["contact", "asset"])).toBe(
      false
    );
    expect(isSceneOptionSelectable(threatOption!, "objective", ["fact", "contact", "task"])).toBe(
      true
    );
  });

  it("keeps action verbs separate from fact event text", () => {
    const options = buildSceneObjectOptions({
      facts: [infrastructureFact, threatFact],
      tracks: [],
    });
    const verbs = options.filter((opt) => opt.kind === "verb");
    expect(verbs.some((opt) => opt.label.includes("rolling outage"))).toBe(false);
    expect(verbs.some((opt) => opt.label === "Coordinate")).toBe(true);
    expect(verbs.length).toBe(15);
  });

  it("groups verbs into tactical categories", () => {
    const options = buildSceneObjectOptions({ facts: [], tracks: [] });
    const verbOptions = filterSceneOptions(options, ["verb"]);
    const groups = groupSceneOptions(verbOptions);
    expect(groups.map((group) => group.label)).toEqual([
      "Maneuver",
      "Fires & effects",
      "Protection",
      "ISR",
      "Support & C2",
    ]);
    expect(groups.find((group) => group.label === "ISR")?.options.map((opt) => opt.label)).toEqual([
      "Investigate",
      "Monitor",
      "Observe",
    ]);
  });

  it("groups objectives by contact type and fact domain", () => {
    const options = buildSceneObjectOptions({
      facts: [infrastructureFact, threatFact],
      tracks: [hostileTrack, unknownTrack],
    });
    const targetOptions = filterSceneOptions(
      options,
      ["fact", "contact", "task"],
      "objective"
    );
    const groups = groupSceneOptions(targetOptions);
    expect(groups.some((group) => group.label === "Threat contacts (red)")).toBe(true);
    expect(groups.some((group) => group.label === "Unknown contacts (grey)")).toBe(true);
    expect(groups.some((group) => group.label.startsWith("Threat ·"))).toBe(true);
    expect(groups.some((group) => group.label.startsWith("Objective · Ground"))).toBe(true);
  });

  it("resolves map fact ids from picker options", () => {
    const options = buildSceneObjectOptions({
      facts: [infrastructureFact],
      tracks: [unknownTrack],
    });
    const contact = options.find((opt) => opt.id === "track:track-unknown");
    const fact = options.find((opt) => opt.id === "fact:fact-relay");
    const verb = options.find((opt) => opt.kind === "verb");

    expect(resolveOptionMapFactId(contact!)).toBe("track-unknown");
    expect(resolveOptionMapFactId(fact!)).toBe("fact-relay");
    expect(resolveOptionMapFactId(verb!)).toBeUndefined();
  });

  it("maps scene selection to actor or target by map symbology", () => {
    const friendlyTrack: OverviewTrack = {
      ...unknownTrack,
      id: "track-friendly",
      callsign: "BLUE-1",
      side: "friendly",
    };
    const options = buildSceneObjectOptions({
      facts: [friendlyFact, threatFact, informationFact],
      tracks: [friendlyTrack, hostileTrack],
    });
    const friendlyContact = options.find((opt) => opt.id === "track:track-friendly");
    const hostileContact = options.find((opt) => opt.id === "track:track-hostile");
    const infoFact = options.find((opt) => opt.id === "fact:fact_info_001");

    expect(sceneSelectionComposerRole(friendlyContact!)).toBe("actor");
    expect(sceneSelectionComposerRole(hostileContact!)).toBe("target");
    expect(sceneSelectionComposerRole(infoFact!)).toBe("target");
    expect(findSceneOptionForFactId("track-hostile", options)?.id).toBe("track:track-hostile");
  });
});
