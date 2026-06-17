#!/usr/bin/env node
/**
 * Publish sample RawSourceReport messages to the intel.raw topic (Redpanda/Kafka).
 *
 * Usage:
 *   KAFKA_BROKERS=127.0.0.1:19092 node scripts/seed-intel-topic.mjs
 */

import { Kafka } from "kafkajs";
import {
  brokerUnavailableMessage,
  parseBrokers,
  waitForBrokers,
} from "./kafka-broker.mjs";

const brokers = parseBrokers();
const topic = process.env.KAFKA_TOPIC ?? "intel.raw";

if (!(await waitForBrokers(brokers))) {
  console.error(brokerUnavailableMessage(brokers));
  process.exit(1);
}

const samples = [
  {
    reportId: "radar-track-4412",
    source: "coastal-radar",
    domain: "air",
    timestamp: new Date().toISOString(),
    text: "Unidentified track bearing 045 at 12,000 ft approaching restricted airspace",
    metadata: {
      entity: "Track T-4412",
      event: "unidentified air track",
      confidence: "medium",
      severity: "high",
      lat: 25.12,
      lng: 121.55,
    },
  },
  {
    reportId: "ais-contact-7781",
    source: "maritime-ais",
    domain: "maritime",
    timestamp: new Date().toISOString(),
    text: "Merchant vessel Kalmar holding outside Port A traffic separation scheme",
    metadata: {
      entity: "MV Kalmar",
      event: "vessel holding pattern",
      location: "Port A approach",
      confidence: "high",
      lat: 25.04,
      lng: 121.51,
    },
  },
];

const kafka = new Kafka({ clientId: "coda2-seed", brokers });
const producer = kafka.producer();

await producer.connect();
for (const report of samples) {
  await producer.send({
    topic,
    messages: [{ key: report.reportId, value: JSON.stringify(report) }],
  });
  console.log(`published ${report.reportId} -> ${topic}`);
}
await producer.disconnect();
console.log("done");
