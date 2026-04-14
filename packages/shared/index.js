export const WS_CLOSE_SERVER_DRAINING = 4010;

export function isClientEvent(value) {
  if (!value || typeof value !== "object") {
    return false;
  }

  return "type" in value;
}
