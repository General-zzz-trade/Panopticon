import { createServer, IncomingMessage, ServerResponse } from "node:http";

const port = Number(process.argv[2] ?? process.env.PORT ?? 3210);

// In-memory state
let loggedIn = false;
let registered = false;
let searchQuery = "";

function route(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  const path = url.pathname;

  res.setHeader("content-type", "text/html; charset=utf-8");

  switch (path) {
    case "/":
      res.end(homePage());
      break;
    case "/login":
      if (req.method === "POST") {
        loggedIn = true;
        res.writeHead(302, { Location: "/dashboard" });
        res.end();
      } else {
        res.end(loginPage());
      }
      break;
    case "/dashboard":
      res.end(loggedIn ? dashboardPage() : loginPage());
      break;
    case "/settings":
      res.end(loggedIn ? settingsPage() : loginPage());
      break;
    case "/search":
      searchQuery = url.searchParams.get("q") ?? "";
      res.end(searchPage(searchQuery));
      break;
    case "/register":
      res.end(registerPage());
      break;
    case "/register/confirm":
      registered = true;
      res.end(confirmPage());
      break;
    case "/register/success":
      res.end(registered ? successPage() : registerPage());
      break;
    case "/api/data":
      // JSON API endpoint
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          items: [
            { id: 1, name: "Task Alpha", status: "done", priority: "high" },
            {
              id: 2,
              name: "Task Beta",
              status: "pending",
              priority: "medium",
            },
            { id: 3, name: "Task Gamma", status: "failed", priority: "low" },
            { id: 4, name: "Task Delta", status: "done", priority: "high" },
            {
              id: 5,
              name: "Task Epsilon",
              status: "pending",
              priority: "medium",
            },
          ],
        }),
      );
      break;
    case "/reset":
      loggedIn = false;
      registered = false;
      searchQuery = "";
      res.end("reset");
      break;
    default:
      res.statusCode = 404;
      res.end(errorPage(path));
      break;
  }
}

// Keep all page functions returning HTML strings
// Include proper IDs and selectors for agent interaction

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title} - Sample Agent App</title>
  <style>
    body { font-family: sans-serif; padding: 24px; max-width: 800px; margin: 0 auto; }
    nav { margin-bottom: 16px; padding: 8px 0; border-bottom: 1px solid #ddd; }
    nav a { margin-right: 12px; text-decoration: none; color: #0066cc; }
    nav a:hover { text-decoration: underline; }
    .btn { padding: 8px 16px; cursor: pointer; border: 1px solid #999; border-radius: 4px; background: #f5f5f5; }
    .btn-primary { background: #0066cc; color: white; border-color: #0066cc; }
    input, select, textarea { padding: 8px; margin: 4px 0; border: 1px solid #ccc; border-radius: 4px; width: 100%; box-sizing: border-box; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    th, td { padding: 8px 12px; border: 1px solid #ddd; text-align: left; }
    th { background: #f5f5f5; cursor: pointer; }
    .form-group { margin-bottom: 12px; }
    label { display: block; margin-bottom: 4px; font-weight: bold; }
    .alert { padding: 12px; border-radius: 4px; margin-bottom: 16px; }
    .alert-success { background: #d4edda; color: #155724; }
    .alert-error { background: #f8d7da; color: #721c24; }
    .search-results { margin-top: 16px; }
    .search-result { padding: 8px; border-bottom: 1px solid #eee; }
    #loading { display: none; color: #666; }
    .status-done { color: green; }
    .status-pending { color: orange; }
    .status-failed { color: red; }
  </style>
</head>
<body>
  <nav>
    <a href="/" id="nav-home">Home</a>
    <a href="/login" id="nav-login">Login</a>
    <a href="/dashboard" id="nav-dashboard">Dashboard</a>
    <a href="/settings" id="nav-settings">Settings</a>
    <a href="/search" id="nav-search">Search</a>
    <a href="/register" id="nav-register">Register</a>
  </nav>
  ${body}
</body>
</html>`;
}

function homePage(): string {
  return layout(
    "Home",
    `
    <h1>Sample Agent App</h1>
    <p id="welcome-text">Welcome to the Sample Agent App. Use the navigation above to explore.</p>
    <button id="login-button" class="btn btn-primary" onclick="window.location='/login'">Login</button>
    <button id="delayed-login-button" class="btn" onclick="handleDelayedLogin()">Delayed Login</button>
    <div id="dashboard">Logged out</div>
    <script>
      function handleDelayedLogin() {
        document.getElementById('dashboard').textContent = 'Loading...';
        setTimeout(() => {
          document.getElementById('dashboard').textContent = 'Dashboard';
        }, 1200);
      }
    </script>
  `,
  );
}

function loginPage(): string {
  return layout(
    "Login",
    `
    <h1>Login</h1>
    <form id="login-form" method="POST" action="/login">
      <div class="form-group">
        <label for="username">Username</label>
        <input type="text" id="username" name="username" placeholder="Enter username" required />
      </div>
      <div class="form-group">
        <label for="password">Password</label>
        <input type="password" id="password" name="password" placeholder="Enter password" required />
      </div>
      <button type="submit" id="submit-login" class="btn btn-primary">Sign In</button>
    </form>
    <p>Don't have an account? <a href="/register" id="register-link">Register here</a></p>
  `,
  );
}

function dashboardPage(): string {
  return layout(
    "Dashboard",
    `
    <h1>Dashboard</h1>
    <div class="alert alert-success" id="welcome-banner">Welcome back! You are logged in.</div>
    <h2>Task Overview</h2>
    <table id="task-table">
      <thead>
        <tr>
          <th id="col-id">ID</th>
          <th id="col-name">Name</th>
          <th id="col-status">Status</th>
          <th id="col-priority">Priority</th>
        </tr>
      </thead>
      <tbody>
        <tr><td>1</td><td>Task Alpha</td><td class="status-done">done</td><td>high</td></tr>
        <tr><td>2</td><td>Task Beta</td><td class="status-pending">pending</td><td>medium</td></tr>
        <tr><td>3</td><td>Task Gamma</td><td class="status-failed">failed</td><td>low</td></tr>
        <tr><td>4</td><td>Task Delta</td><td class="status-done">done</td><td>high</td></tr>
        <tr><td>5</td><td>Task Epsilon</td><td class="status-pending">pending</td><td>medium</td></tr>
      </tbody>
    </table>
    <p id="task-count">Total: 5 tasks</p>
    <div>
      <button id="btn-refresh" class="btn" onclick="handleRefresh()">Refresh Data</button>
      <span id="loading">Loading...</span>
    </div>
    <div id="dynamic-content"></div>
    <script>
      function handleRefresh() {
        document.getElementById('loading').style.display = 'inline';
        setTimeout(() => {
          document.getElementById('loading').style.display = 'none';
          document.getElementById('dynamic-content').textContent = 'Data refreshed at ' + new Date().toLocaleTimeString();
        }, 800);
      }
    </script>
  `,
  );
}

function settingsPage(): string {
  return layout(
    "Settings",
    `
    <h1>Settings</h1>
    <form id="settings-form">
      <div class="form-group">
        <label for="theme">Theme</label>
        <select id="theme" name="theme">
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="auto">Auto</option>
        </select>
      </div>
      <div class="form-group">
        <label for="language">Language</label>
        <select id="language" name="language">
          <option value="en">English</option>
          <option value="zh">中文</option>
          <option value="ja">日本語</option>
        </select>
      </div>
      <div class="form-group">
        <label for="notifications">
          <input type="checkbox" id="notifications" name="notifications" checked /> Enable notifications
        </label>
      </div>
      <button type="button" id="save-settings" class="btn btn-primary" onclick="handleSaveSettings()">Save Settings</button>
      <div id="settings-status"></div>
    </form>
    <script>
      function handleSaveSettings() {
        document.getElementById('settings-status').textContent = 'Settings saved successfully!';
        document.getElementById('settings-status').className = 'alert alert-success';
      }
    </script>
  `,
  );
}

function searchPage(query: string): string {
  const results = query ? generateSearchResults(query) : "";
  return layout(
    "Search",
    `
    <h1>Search</h1>
    <form id="search-form" method="GET" action="/search">
      <div class="form-group" style="display:flex;gap:8px;">
        <input type="text" id="search-input" name="q" placeholder="Search..." value="${escapeHtml(query)}" />
        <button type="submit" id="search-submit" class="btn btn-primary">Search</button>
      </div>
    </form>
    <div id="search-results" class="search-results">
      ${results}
    </div>
  `,
  );
}

function generateSearchResults(query: string): string {
  const items = [
    { title: "Getting Started Guide", desc: "Learn how to use the app" },
    { title: "API Documentation", desc: "REST API reference" },
    { title: "User Settings", desc: "Configure your preferences" },
    { title: "Task Management", desc: "Create and manage tasks" },
    { title: "Dashboard Overview", desc: "Monitor your progress" },
  ].filter(
    (item) =>
      item.title.toLowerCase().includes(query.toLowerCase()) ||
      item.desc.toLowerCase().includes(query.toLowerCase()),
  );

  if (items.length === 0) {
    return `<p id="no-results">No results found for "${escapeHtml(query)}"</p>`;
  }

  return (
    `<p id="result-count">${items.length} result(s) for "${escapeHtml(query)}"</p>` +
    items
      .map(
        (item, i) =>
          `<div class="search-result" id="result-${i}"><strong>${item.title}</strong><br/>${item.desc}</div>`,
      )
      .join("")
  );
}

function registerPage(): string {
  return layout(
    "Register",
    `
    <h1>Create Account</h1>
    <form id="register-form" method="GET" action="/register/confirm">
      <div class="form-group">
        <label for="reg-name">Full Name</label>
        <input type="text" id="reg-name" name="name" placeholder="John Doe" required />
      </div>
      <div class="form-group">
        <label for="reg-email">Email</label>
        <input type="email" id="reg-email" name="email" placeholder="john@example.com" required />
      </div>
      <div class="form-group">
        <label for="reg-password">Password</label>
        <input type="password" id="reg-password" name="password" placeholder="At least 8 characters" required />
      </div>
      <div class="form-group">
        <label for="reg-role">Role</label>
        <select id="reg-role" name="role">
          <option value="user">User</option>
          <option value="admin">Admin</option>
          <option value="viewer">Viewer</option>
        </select>
      </div>
      <button type="submit" id="register-submit" class="btn btn-primary">Create Account</button>
    </form>
    <p>Already have an account? <a href="/login" id="login-link">Login here</a></p>
  `,
  );
}

function confirmPage(): string {
  return layout(
    "Confirm",
    `
    <h1>Confirm Registration</h1>
    <div class="alert alert-success" id="confirm-message">Your account has been created. Please confirm to continue.</div>
    <a href="/register/success" id="confirm-link" class="btn btn-primary">Confirm &amp; Continue</a>
  `,
  );
}

function successPage(): string {
  return layout(
    "Success",
    `
    <h1>Registration Complete</h1>
    <div class="alert alert-success" id="success-message">Welcome! Your account is now active.</div>
    <a href="/login" id="goto-login" class="btn btn-primary">Go to Login</a>
  `,
  );
}

function errorPage(path: string): string {
  return layout(
    "404 Not Found",
    `
    <h1>404 - Page Not Found</h1>
    <div class="alert alert-error" id="error-message">The page "${escapeHtml(path)}" does not exist.</div>
    <a href="/" id="back-home" class="btn">Back to Home</a>
  `,
  );
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const server = createServer(route);
server.listen(port, "127.0.0.1", () => {
  console.log(`Sample app listening on http://127.0.0.1:${port}`);
});
