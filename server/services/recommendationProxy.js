const axios = require("axios");

const BASE = process.env.RECO_API_BASE || "http://127.0.0.1:8000";
const TIMEOUT = +(process.env.RECO_TIMEOUT_MS || 7000);

class RecommendationUpstreamError extends Error {
  constructor({ status, upstream, variationId, base }) {
    super(`upstream_${status}`);
    this.name = "RecommendationUpstreamError";
    this.upstreamStatus = status;
    this.upstream = upstream;
    this.variationId = variationId;
    this.base = base;
  }
}

class RecommendationAdapterError extends Error {
  constructor({ message, code, base, variationId }) {
    super(message);
    this.name = "RecommendationAdapterError";
    this.code = code;
    this.base = base;
    this.variationId = variationId;
  }
}

/**
 * Proxy GET ${RECO_API_BASE}/recommend?variation_id=...
 * @param {number} variationId
 * @param {{ timeout?: number, base?: string }} [options]
 * @returns {Promise<object>} upstream JSON body on 2xx
 * @throws {RecommendationUpstreamError} upstream status >= 400
 * @throws {RecommendationAdapterError} network/timeout/axios failure
 */
async function getRecommendations(variationId, options = {}) {
  const base = options.base ?? BASE;
  const timeout = options.timeout ?? TIMEOUT;

  try {
    const resp = await axios.get(`${base}/recommend`, {
      params: { variation_id: variationId },
      timeout,
      validateStatus: () => true,
    });

    if (resp.status >= 400) {
      throw new RecommendationUpstreamError({
        status: resp.status,
        upstream: resp.data,
        variationId,
        base,
      });
    }

    return resp.data;
  } catch (err) {
    if (err instanceof RecommendationUpstreamError) {
      throw err;
    }
    throw new RecommendationAdapterError({
      message: err.message,
      code: err.code,
      base,
      variationId,
    });
  }
}

module.exports = {
  getRecommendations,
  RecommendationUpstreamError,
  RecommendationAdapterError,
  BASE,
  TIMEOUT,
};
