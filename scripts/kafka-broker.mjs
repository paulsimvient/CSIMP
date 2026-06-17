import net from "node:net";

export function parseBrokers(raw = process.env.KAFKA_BROKERS ?? "127.0.0.1:19092") {
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseBrokerAddress(broker) {
  const [host, portRaw] = broker.includes(":")
    ? broker.split(":")
    : [broker, "9092"];
  return { host, port: Number(portRaw) };
}

export function probeBroker(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: timeoutMs });
    const finish = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.on("connect", () => finish(true));
    socket.on("error", () => finish(false));
    socket.on("timeout", () => finish(false));
  });
}

export async function waitForBrokers(
  brokers,
  { timeoutMs = 45_000, intervalMs = 1_000 } = {}
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const broker of brokers) {
      const { host, port } = parseBrokerAddress(broker);
      if (await probeBroker(host, port)) {
        return true;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

export function brokerUnavailableMessage(brokers) {
  return [
    `Cannot reach Kafka broker at ${brokers.join(", ")}.`,
    "Start Redpanda first:",
    "  npm run redpanda:up",
    "Or run the full stack:",
    "  REDPANDA_INGEST=1 ./run.sh",
    "Then retry the bench.",
  ].join("\n");
}
