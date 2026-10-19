const normalizeOrigin = (value) => value.trim().replace(/\/+$/, "");

const allowedOriginPatterns = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/(?:www\.)?unipackauto\.com$/i,
  /^https:\/\/unipackauto(?:-[a-z0-9-]+)?\.vercel\.app$/i,
];

export const createCorsOptions = (clientOrigin = process.env.CLIENT_ORIGIN || "") => {
  const envOrigins = clientOrigin
    .split(",")
    .map(normalizeOrigin)
    .filter(Boolean);

  return {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const normalizedOrigin = normalizeOrigin(origin);
      const isAllowed =
        envOrigins.includes(normalizedOrigin) ||
        allowedOriginPatterns.some((pattern) => pattern.test(normalizedOrigin));
      callback(null, isAllowed);
    },
    credentials: true,
  };
};
