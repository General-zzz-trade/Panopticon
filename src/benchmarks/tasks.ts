export type TaskDifficulty = "trivial" | "simple" | "medium" | "complex" | "expert";
export type TaskCategory = "navigation" | "form" | "assertion" | "search" | "multi-step" | "recovery" | "dynamic";

export interface BenchmarkTask {
  id: string;
  name: string;
  difficulty: TaskDifficulty;
  category: TaskCategory;
  goal: string;        // The goal string to pass to runGoal
  verify: (result: any) => boolean;  // Check if the run succeeded
  description: string;
}

export function getBenchmarkTasks(command: string, url: string): BenchmarkTask[] {
  return [
    // --- TRIVIAL (5): basic single-action tasks ---
    {
      id: "T01", name: "Open home page",
      difficulty: "trivial", category: "navigation",
      goal: `start app "${command}" and wait for server "${url}" and open page "${url}" and assert text "Sample Agent App" and stop app`,
      verify: r => r.result?.success === true || r.tasks?.some((t: any) => t.type === "assert_text" && t.status === "done"),
      description: "Open the home page and verify title text"
    },
    {
      id: "T02", name: "Take screenshot",
      difficulty: "trivial", category: "navigation",
      goal: `start app "${command}" and wait for server "${url}" and open page "${url}" and screenshot and stop app`,
      verify: r => r.result?.success === true,
      description: "Open page and take a screenshot"
    },
    {
      id: "T03", name: "Navigate to login page",
      difficulty: "trivial", category: "navigation",
      goal: `start app "${command}" and wait for server "${url}" and open page "${url}/login" and assert text "Sign In" and stop app`,
      verify: r => r.result?.success === true,
      description: "Navigate directly to login page"
    },
    {
      id: "T04", name: "Navigate to search page",
      difficulty: "trivial", category: "navigation",
      goal: `start app "${command}" and wait for server "${url}" and open page "${url}/search" and assert text "Search" and stop app`,
      verify: r => r.result?.success === true,
      description: "Navigate to search page"
    },
    {
      id: "T05", name: "Check API endpoint",
      difficulty: "trivial", category: "assertion",
      goal: `start app "${command}" and wait for server "${url}" and http_request "${url}/api/data" and stop app`,
      verify: r => r.result?.success === true,
      description: "Hit the JSON API endpoint"
    },

    // --- SIMPLE (5): click + verify ---
    {
      id: "S01", name: "Click login button on home",
      difficulty: "simple", category: "navigation",
      goal: `start app "${command}" and wait for server "${url}" and open page "${url}" and click "#login-button" and assert text "Sign In" and stop app`,
      verify: r => r.result?.success === true,
      description: "Click login button which navigates to login page"
    },
    {
      id: "S02", name: "Click delayed login",
      difficulty: "simple", category: "dynamic",
      goal: `start app "${command}" and wait for server "${url}" and open page "${url}" and click "#delayed-login-button" and wait 2000 and assert text "Dashboard" and stop app`,
      verify: r => r.result?.success === true,
      description: "Click delayed login and wait for dashboard text to appear"
    },
    {
      id: "S03", name: "Navigate to register",
      difficulty: "simple", category: "navigation",
      goal: `start app "${command}" and wait for server "${url}" and open page "${url}/login" and click "#register-link" and assert text "Create Account" and stop app`,
      verify: r => r.result?.success === true,
      description: "Go to login page then click register link"
    },
    {
      id: "S04", name: "Navigate to dashboard from nav",
      difficulty: "simple", category: "navigation",
      goal: `start app "${command}" and wait for server "${url}" and open page "${url}" and click "#nav-dashboard" and assert text "Dashboard" and stop app`,
      verify: r => r.result?.success === true || r.tasks?.some((t: any) => t.type === "open_page" && t.status === "done"),
      description: "Use nav link to go to dashboard"
    },
    {
      id: "S05", name: "Search with results",
      difficulty: "simple", category: "search",
      goal: `start app "${command}" and wait for server "${url}" and open page "${url}/search?q=API" and assert text "API Documentation" and stop app`,
      verify: r => r.result?.success === true,
      description: "Open search page with query parameter and verify results"
    },

    // --- MEDIUM (8): multi-action flows ---
    {
      id: "M01", name: "Login form submission",
      difficulty: "medium", category: "form",
      goal: `start app "${command}" and wait for server "${url}" and open page "${url}/login" and type "#username" "admin" and type "#password" "secret" and click "#submit-login" and assert text "Dashboard" and stop app`,
      verify: r => r.result?.success === true,
      description: "Fill login form and submit"
    },
    {
      id: "M02", name: "Search via form",
      difficulty: "medium", category: "search",
      goal: `start app "${command}" and wait for server "${url}" and open page "${url}/search" and type "#search-input" "task" and click "#search-submit" and assert text "Task Management" and stop app`,
      verify: r => r.result?.success === true,
      description: "Type search query and submit form"
    },
    {
      id: "M03", name: "Change settings dropdown",
      difficulty: "medium", category: "form",
      goal: `start app "${command}" and wait for server "${url}" and open page "${url}/login" and type "#username" "admin" and type "#password" "pass" and click "#submit-login" and open page "${url}/settings" and select "#theme" "dark" and click "#save-settings" and assert text "Settings saved" and stop app`,
      verify: r => r.result?.success === true,
      description: "Login then change theme setting"
    },
    {
      id: "M04", name: "Registration form",
      difficulty: "medium", category: "form",
      goal: `start app "${command}" and wait for server "${url}" and open page "${url}/register" and type "#reg-name" "John Doe" and type "#reg-email" "john@example.com" and type "#reg-password" "password123" and click "#register-submit" and assert text "Confirm" and stop app`,
      verify: r => r.result?.success === true,
      description: "Fill out registration form and submit"
    },
    {
      id: "M05", name: "Dashboard data table check",
      difficulty: "medium", category: "assertion",
      goal: `start app "${command}" and wait for server "${url}" and open page "${url}/login" and type "#username" "admin" and type "#password" "pass" and click "#submit-login" and assert text "Task Alpha" and assert text "5 tasks" and stop app`,
      verify: r => r.result?.success === true,
      description: "Login and verify dashboard data table content"
    },
    {
      id: "M06", name: "Search no results",
      difficulty: "medium", category: "search",
      goal: `start app "${command}" and wait for server "${url}" and open page "${url}/search" and type "#search-input" "nonexistent" and click "#search-submit" and assert text "No results" and stop app`,
      verify: r => r.result?.success === true,
      description: "Search for non-existent term and verify empty results"
    },
    {
      id: "M07", name: "Navigate home from 404",
      difficulty: "medium", category: "recovery",
      goal: `start app "${command}" and wait for server "${url}" and open page "${url}/nonexistent" and assert text "404" and click "#back-home" and assert text "Sample Agent App" and stop app`,
      verify: r => r.result?.success === true,
      description: "Hit 404 page then navigate back home"
    },
    {
      id: "M08", name: "Dynamic content refresh",
      difficulty: "medium", category: "dynamic",
      goal: `start app "${command}" and wait for server "${url}" and open page "${url}/login" and type "#username" "admin" and type "#password" "pass" and click "#submit-login" and click "#btn-refresh" and wait 1000 and assert text "Data refreshed" and stop app`,
      verify: r => r.result?.success === true,
      description: "Login, click refresh button, wait for dynamic content"
    },

    // --- COMPLEX (8): multi-step + verification ---
    {
      id: "C01", name: "Full registration flow",
      difficulty: "complex", category: "multi-step",
      goal: `start app "${command}" and wait for server "${url}" and open page "${url}/register" and type "#reg-name" "Jane Smith" and type "#reg-email" "jane@test.com" and type "#reg-password" "secure123" and select "#reg-role" "admin" and click "#register-submit" and assert text "Confirm" and click "#confirm-link" and assert text "Registration Complete" and stop app`,
      verify: r => r.result?.success === true,
      description: "Complete 3-step registration: form -> confirm -> success"
    },
    {
      id: "C02", name: "Login then navigate all pages",
      difficulty: "complex", category: "navigation",
      goal: `start app "${command}" and wait for server "${url}" and open page "${url}/login" and type "#username" "admin" and type "#password" "pass" and click "#submit-login" and assert text "Dashboard" and click "#nav-settings" and assert text "Settings" and click "#nav-search" and assert text "Search" and stop app`,
      verify: r => r.result?.success === true,
      description: "Login then visit dashboard, settings, search via nav"
    },
    {
      id: "C03", name: "Register then login",
      difficulty: "complex", category: "multi-step",
      goal: `start app "${command}" and wait for server "${url}" and open page "${url}/register" and type "#reg-name" "Test User" and type "#reg-email" "test@test.com" and type "#reg-password" "pass1234" and click "#register-submit" and click "#confirm-link" and assert text "Registration Complete" and click "#goto-login" and assert text "Sign In" and type "#username" "test" and type "#password" "pass1234" and click "#submit-login" and assert text "Dashboard" and stop app`,
      verify: r => r.result?.success === true,
      description: "Register, confirm, then login with new account"
    },
    {
      id: "C04", name: "Search + verify + screenshot",
      difficulty: "complex", category: "search",
      goal: `start app "${command}" and wait for server "${url}" and open page "${url}/search" and type "#search-input" "guide" and click "#search-submit" and assert text "Getting Started Guide" and screenshot and stop app`,
      verify: r => r.result?.success === true,
      description: "Search, verify specific result, take screenshot"
    },
    {
      id: "C05", name: "Settings with language change",
      difficulty: "complex", category: "form",
      goal: `start app "${command}" and wait for server "${url}" and open page "${url}/login" and type "#username" "a" and type "#password" "b" and click "#submit-login" and open page "${url}/settings" and select "#theme" "dark" and select "#language" "zh" and click "#save-settings" and assert text "Settings saved" and screenshot and stop app`,
      verify: r => r.result?.success === true,
      description: "Login, change both theme and language settings, save"
    },
    {
      id: "C06", name: "Recovery from wrong selector",
      difficulty: "complex", category: "recovery",
      goal: `start app "${command}" and wait for server "${url}" and open page "${url}" and click "#nonexistent-button" and assert text "Dashboard" and stop app`,
      verify: r => r.replanCount >= 1 || r.result?.success === false || r.terminationReason !== undefined,
      description: "Click non-existent button -- should trigger replan/recovery or graceful failure"
    },
    {
      id: "C07", name: "Recovery from wrong assertion",
      difficulty: "complex", category: "recovery",
      goal: `start app "${command}" and wait for server "${url}" and open page "${url}" and click "#login-button" and assert text "Wrong Text That Does Not Exist" and stop app`,
      verify: r => r.replanCount >= 1 || r.result?.success === false || r.terminationReason !== undefined,
      description: "Assert wrong text -- should trigger recovery or graceful failure"
    },
    {
      id: "C08", name: "Hover + delayed content",
      difficulty: "complex", category: "dynamic",
      goal: `start app "${command}" and wait for server "${url}" and open page "${url}/login" and type "#username" "admin" and type "#password" "pass" and click "#submit-login" and hover "#col-name" and click "#btn-refresh" and wait 1000 and assert text "Data refreshed" and screenshot and stop app`,
      verify: r => r.result?.success === true,
      description: "Login, hover table header, refresh dynamic content"
    },

    // --- EXPERT (4): edge cases + timeout ---
    {
      id: "E01", name: "Timeout on unreachable server",
      difficulty: "expert", category: "recovery",
      goal: `wait for server "http://127.0.0.1:1" timeout 2 second`,
      verify: r => r.result?.success === false && r.terminationReason !== undefined,
      description: "Wait for unreachable server -- should fail gracefully"
    },
    {
      id: "E02", name: "404 error detection",
      difficulty: "expert", category: "assertion",
      goal: `start app "${command}" and wait for server "${url}" and open page "${url}/this-page-does-not-exist" and assert text "404" and assert text "does not exist" and stop app`,
      verify: r => r.result?.success === true,
      description: "Navigate to non-existent page and verify 404 message"
    },
    {
      id: "E03", name: "Full workflow: register + login + dashboard + settings + search",
      difficulty: "expert", category: "multi-step",
      goal: `start app "${command}" and wait for server "${url}" and open page "${url}/register" and type "#reg-name" "Full Test" and type "#reg-email" "full@test.com" and type "#reg-password" "fullpass" and click "#register-submit" and click "#confirm-link" and click "#goto-login" and type "#username" "full" and type "#password" "fullpass" and click "#submit-login" and assert text "Dashboard" and click "#nav-settings" and select "#theme" "dark" and click "#save-settings" and assert text "Settings saved" and click "#nav-search" and type "#search-input" "task" and click "#search-submit" and assert text "Task Management" and screenshot and stop app`,
      verify: r => r.result?.success === true,
      description: "Complete end-to-end: register -> login -> dashboard -> settings -> search"
    },
    {
      id: "E04", name: "Multiple screenshots in flow",
      difficulty: "expert", category: "multi-step",
      goal: `start app "${command}" and wait for server "${url}" and open page "${url}" and screenshot and click "#nav-login" and screenshot and type "#username" "admin" and type "#password" "pass" and click "#submit-login" and screenshot and stop app`,
      verify: r => r.result?.success === true,
      description: "Take screenshots at multiple points in the flow"
    }
  ];
}
