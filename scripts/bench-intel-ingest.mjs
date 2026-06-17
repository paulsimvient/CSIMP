#!/usr/bin/env node
/**
 * Publish N synthetic intel reports to Redpanda/Kafka for throughput demos.
 *
 * Usage:
 *   npm run redpanda:bench
 *   COUNT=100000 BATCH_SIZE=500 npm run redpanda:bench
 *
 * Watch consumption:
 *   curl -s http://127.0.0.1:5173/api/intel/ingest/status | jq
 */

import { Kafka, Partitioners } from "kafkajs";
import {
  brokerUnavailableMessage,
  parseBrokers,
  waitForBrokers,
} from "./kafka-broker.mjs";

const brokers = parseBrokers();
const topic = process.env.KAFKA_TOPIC ?? "intel.raw";
const count = Number(process.env.COUNT ?? "100000");
const batchSize = Number(process.env.BATCH_SIZE ?? "500");
const domains = ["air", "maritime", "cyber", "signals", "UAS", "ground"];

if (!Number.isFinite(count) || count <= 0) {
  console.error("COUNT must be a positive integer");
  process.exit(1);
}
if (!Number.isFinite(batchSize) || batchSize <= 0) {
  console.error("BATCH_SIZE must be a positive integer");
  process.exit(1);
}

console.log(`waiting for broker ${brokers.join(", ")}…`);
if (!(await waitForBrokers(brokers))) {
  console.error(brokerUnavailableMessage(brokers));
  process.exit(1);
}
console.log("broker ready");

function buildReport(index) {
  const domain = domains[index % domains.length];
  const id = `bench-${String(index).padStart(6, "0")}`;
  const minute = Math.floor(index / 60);
  const ts = new Date(Date.UTC(2026, 5, 4, 12, minute % 60, index % 60)).toISOString();
  return {
    reportId: id,
    source: `bench-feed-${index % 20}`,
    domain,
    timestamp: ts,
    text: `Synthetic ${domain} observation #${index} for throughput demonstration`,
    metadata: {
      entity: `Entity-${index % 250}`,
      event: `synthetic-${domain}-event`,
      confidence: index % 5 === 0 ? "low" : "medium",
      severity: index % 17 === 0 ? "high" : "medium",
      lat: 24 + (index % 100) / 100,
      lng: 121 + (index % 100) / 100,
    },
  };
}

const kafka = new Kafka({ clientId: "coda2-bench-ingest", brokers });
const producer = kafka.producer({
  createPartitioner: Partitioners.DefaultPartitioner,
});

const started = performance.now();
await producer.connect();

let published = 0;
while (published < count) {
  const chunk = Math.min(batchSize, count - published);
  const messages = Array.from({ length: chunk }, (_, offset) => {
    const index = published + offset;
    const report = buildReport(index);
    return {
      key: report.reportId,
      value: JSON.stringify(report),
    };
  });
  await producer.send({ topic, messages });
  published += chunk;
  if (published % 10_000 === 0 || published === count) {
    const elapsed = (performance.now() - started) / 1000;
    const rate = Math.round(published / Math.max(elapsed, 0.001));
    console.log(`published ${published}/${count} (${rate}/s)`);
  }
}

await producer.disconnect();
const elapsedSec = (performance.now() - started) / 1000;
console.log(
  `done: ${count} messages to ${topic} @ ${brokers.join(",")} in ${elapsedSec.toFixed(1)}s (${Math.round(count / Math.max(elapsedSec, 0.001))}/s)`
);
