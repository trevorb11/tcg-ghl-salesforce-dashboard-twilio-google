import re

with open("server/routes.ts", "r") as f:
    content = f.read()

# Remove broken one-liner if present
content = re.sub(r'\n// POST /api/admin/claude/dialer-sql[^\n]*\n', '\n', content)

# Find and patch the SQL endpoint's catch block
old = '    } catch (error) {\n      res.status(500).json({ error: String(error) });\n    }\n  });\n\n  // POST /api/admin/claude/mutate'

new = '''    } catch (error: any) {
      // If table not found in main DB, try Neon dialer database
      if (neonPool && error?.message?.includes("does not exist")) {
        try {
          const neonResult = await neonPool.query(query, params);
          return res.json({ rows: neonResult.rows, rowCount: neonResult.rowCount, source: "neon" });
        } catch (neonError) {
          return res.status(500).json({ error: String(neonError) });
        }
      }
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/admin/claude/dialer-sql
  app.post("/api/admin/claude/dialer-sql", claudeAuth, async (req: Request, res: Response) => {
    if (!neonPool) {
      return res.status(500).json({ error: "Neon database not configured" });
    }
    const { query: q, params: p = [] } = req.body;
    if (!q || typeof q !== "string") {
      return res.status(400).json({ error: "body.query is required" });
    }
    const trimmed = q.trim().toUpperCase();
    if (!trimmed.startsWith("SELECT") && !trimmed.startsWith("WITH") && !trimmed.startsWith("EXPLAIN")) {
      return res.status(403).json({ error: "Only SELECT/WITH/EXPLAIN queries allowed" });
    }
    try {
      const result = await neonPool.query(q, p);
      res.json({ rows: result.rows, rowCount: result.rowCount });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/admin/claude/mutate'''

if old in content:
    content = content.replace(old, new)
    print("Patched SQL endpoint with Neon fallback + dialer-sql endpoint")
else:
    print("WARN: Exact match not found, trying flexible match...")
    # The catch block might have been modified already
    if 'catch (error: any)' in content:
        print("Already patched (error: any found)")
    else:
        print("ERROR: Could not find the SQL catch block to patch")

with open("server/routes.ts", "w") as f:
    f.write(content)
