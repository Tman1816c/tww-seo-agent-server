function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable ${name}. Check your .env file / docker-compose environment block.`
    );
  }
  return value;
}

export const config = {
  wp: {
    siteUrl: requireEnv("WP_SITE_URL").replace(/\/+$/, ""), // e.g. https://timswebworx.co.za, no trailing slash
    username: requireEnv("WP_USERNAME"),
    appPassword: requireEnv("WP_APP_PASSWORD"),
  },
  server: {
    port: parseInt(process.env.PORT || "3000", 10),
    // The public hostname Caddy will present this server as (used for the
    // MCP SDK's DNS-rebinding allowedHosts check). e.g. mymcp.timswebworx.co.za
    publicHost: requireEnv("MCP_PUBLIC_HOST"),
    // Shared secret the .mcp.json config sends as "Authorization: Bearer <token>".
    bearerToken: requireEnv("MCP_BEARER_TOKEN"),
  },
};
