// Set fake env vars so suspension-calc.ts module-level check passes
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
