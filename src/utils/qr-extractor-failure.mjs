export function reportQrExtractorFailure(error, onError) {
  try {
    onError?.(error);
  } catch {
    // Diagnostics must not replace the original extraction result.
  }
}

/** Record the actual decoder call before fallback code handles its exception. */
export async function traceQrDecodeAttempt(decode, context, onAttempt) {
  const started = performance.now();
  const record = (result) => reportQrExtractorFailure({
    ...context,
    ...result,
    elapsedMs: Math.round(performance.now() - started),
  }, onAttempt);
  try {
    const result = await decode();
    record({ outcome: result?.data && result.location ? "decoded" : "not_found" });
    return result;
  } catch (error) {
    const errorName = error?.name || error?.constructor?.name || "Error";
    const outcome = errorName === "NotFoundException" ? "not_found"
      : ["ChecksumException", "FormatException"].includes(errorName) ? "invalid_symbol" : "error";
    record({ outcome, errorName, errorMessage: String(error?.message || error).slice(0, 300) });
    throw error;
  }
}
