// Environment variables declared in netlify.toml are build-time only —
// Netlify does not expose them to serverless functions at runtime. A
// production deploy would therefore boot the API without NODE_ENV=production
// and fall back to dev conveniences (OTP devCode echo, demo payments, no
// email/SMS config gates). CONTEXT is a Netlify read-only runtime variable:
// it is "production" / "deploy-preview" / "branch-deploy" on deployed sites
// and "dev" under `netlify dev`, so local development keeps its dev flows.
if (process.env.CONTEXT && process.env.CONTEXT !== 'dev' && !process.env.NODE_ENV) {
  process.env.NODE_ENV = 'production';
}
