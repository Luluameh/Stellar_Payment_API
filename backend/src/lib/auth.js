import { validateApiKeyFormat, logSecurityEvent } from "./security.js";

export function createApiKeyAuth({ supabaseClient = null } = {}) {
  return async function requireApiKeyAuth(req, res, next) {
    try {
      const client = supabaseClient || (await import("./supabase.js")).supabase;
      const headerValue = req.get("x-api-key");
      const apiKey = typeof headerValue === "string" ? headerValue.trim() : "";

      // Validate API key format before querying database
      if (!apiKey) {
        logSecurityEvent("MISSING_API_KEY", {
          path: req.path,
          method: req.method,
          ip: req.ip,
        });
        return res.status(401).json({ error: "Missing x-api-key header" });
      }

      // Validate API key format to prevent injection attacks
      if (!validateApiKeyFormat(apiKey)) {
        logSecurityEvent("INVALID_API_KEY_FORMAT", {
          path: req.path,
          method: req.method,
          ip: req.ip,
        });
        return res.status(401).json({ error: "Invalid API key format" });
      }

      const { data: merchant, error } = await client
        .from("merchants")
        .select("id, email, business_name, notification_email, api_key_rotated_at")
        .eq("api_key", apiKey)
        .maybeSingle();

      if (error) {
        logSecurityEvent("DATABASE_ERROR", {
          path: req.path,
          method: req.method,
          errorMessage: error.message,
        });
        error.status = 500;
        throw error;
      }

      if (!merchant) {
        logSecurityEvent("INVALID_API_KEY", {
          path: req.path,
          method: req.method,
          ip: req.ip,
        });
        return res.status(401).json({ error: "Invalid API key" });
      }

      // Attach merchant to request for use in routes
      req.merchant = merchant;
      
      logSecurityEvent("AUTH_SUCCESS", {
        merchantId: merchant.id,
        path: req.path,
        method: req.method,
      });

      next();
    } catch (err) {
      logSecurityEvent("AUTH_ERROR", {
        path: req.path,
        method: req.method,
        error: err.message,
      });
      next(err);
    }
  };
}

export function requireApiKeyAuth(options) {
  return createApiKeyAuth(options);
}
