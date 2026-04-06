/**
 * Panopticon CLI — command-line interface for direct OSINT operations
 * Usage: npx tsx src/osint/cli.ts <command> <target> [options]
 */

const HELP = `
Panopticon CLI — Open Source Intelligence Platform

Usage:
  npx tsx src/osint/cli.ts <command> <target> [options]

Commands:
  investigate <target>     Full OSINT investigation (domain/IP/email/username)
  domain <domain>          Domain recon (WHOIS + DNS + subdomains + certs)
  network <ip|domain>      Network scan (ports + geo + banners + headers)
  identity <user|email>    Identity lookup (37+ platforms + email validation)
  web <url>                Web intelligence (tech stack + wayback + dorks)
  threat <domain|url>      Threat check (URLhaus + DNSBL + SSL + patterns)
  asn <ip>                 ASN/reverse IP intelligence
  breach <email|password>  Breach/leak check (HIBP k-anonymity)
  subdomain <domain>       Deep subdomain bruteforce (300+ prefixes)
  takeover <domain>        Subdomain takeover detection
  waf <url>                WAF/CDN detection
  js <url>                 JavaScript secret/endpoint extraction
  cve <ip|domain>          CVE vulnerability matching
  typosquat <domain>       Typosquatting domain detection
  cloud <domain>           S3/Azure/GCP bucket enumeration
  api <url>                Hidden API endpoint discovery
  news <query>             Security news monitoring
  crawl <url>              Deep site crawl
  github <org|domain>      GitHub code leak scan
  nl <query>               Natural language investigation

Options:
  --json                   Output raw JSON
  --quiet                  Minimal output

Examples:
  npx tsx src/osint/cli.ts investigate github.com
  npx tsx src/osint/cli.ts identity torvalds
  npx tsx src/osint/cli.ts breach password123
  npx tsx src/osint/cli.ts nl "scan ports on 8.8.8.8"
`;

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(HELP);
    process.exit(0);
  }

  const command = args[0];
  const target = args[1];
  const isJson = args.includes("--json");
  const isQuiet = args.includes("--quiet");

  if (!target && command !== "nl") {
    console.error(`Error: target is required for command "${command}"`);
    process.exit(1);
  }

  const log = (msg: string) => { if (!isQuiet) console.log(msg); };
  const start = Date.now();

  try {
    let result: any;

    switch (command) {
      case "investigate": {
        const { investigate } = await import("./index.js");
        log(`[*] Running full investigation on ${target}...`);
        result = await investigate(target);
        if (!isJson) {
          log(`\n[+] Risk Level: ${result.report.riskLevel}`);
          log(`[+] Entities: ${(result.graph as any).stats?.entityCount}`);
          log(`[+] Relations: ${(result.graph as any).stats?.relationCount}`);
          if (result.report.riskFactors.length > 0) {
            log(`\n[!] Risk Factors:`);
            result.report.riskFactors.forEach((f: string) => log(`    - ${f}`));
          }
        }
        break;
      }
      case "domain": {
        const { fullDomainRecon } = await import("./domain-recon.js");
        log(`[*] Domain recon: ${target}`);
        result = await fullDomainRecon(target);
        if (!isJson) {
          log(`[+] Registrar: ${result.whois.registrar || "N/A"}`);
          log(`[+] DNS Records: ${result.dns.length}`);
          log(`[+] Subdomains: ${result.subdomains.length}`);
          log(`[+] Certificates: ${result.certificates.length}`);
        }
        break;
      }
      case "network": {
        const { fullNetworkRecon } = await import("./network-recon.js");
        log(`[*] Network scan: ${target}`);
        result = await fullNetworkRecon(target);
        const open = result.openPorts.filter((p: any) => p.state === "open");
        if (!isJson) {
          log(`[+] IP: ${result.resolvedIp || target}`);
          log(`[+] Location: ${result.geo?.country} ${result.geo?.city}`);
          log(`[+] Open ports: ${open.map((p: any) => `${p.port}/${p.service || "?"}`).join(", ")}`);
        }
        break;
      }
      case "identity": {
        const { fullIdentityRecon } = await import("./identity-recon.js");
        log(`[*] Identity lookup: ${target}`);
        result = await fullIdentityRecon(target);
        if (!isJson) {
          log(`[+] Found: ${result.foundProfiles.length}/${result.platformCount} platforms`);
          result.foundProfiles.forEach((p: any) => log(`    [+] ${p.platform}: ${p.url}`));
        }
        break;
      }
      case "web": {
        const { fullWebIntel } = await import("./web-intel.js");
        const url = target.startsWith("http") ? target : `https://${target}`;
        log(`[*] Web intel: ${url}`);
        result = await fullWebIntel(url);
        if (!isJson) {
          log(`[+] Server: ${result.techStack.server || "N/A"}`);
          log(`[+] JS: ${result.techStack.javascript.join(", ") || "none"}`);
          log(`[+] Wayback: ${result.wayback.totalSnapshots} snapshots`);
        }
        break;
      }
      case "threat": {
        const { fullThreatCheck } = await import("./threat-intel.js");
        log(`[*] Threat check: ${target}`);
        result = await fullThreatCheck(target);
        if (!isJson) {
          log(`[+] Risk Score: ${result.riskScore}/100`);
          log(`[+] Malicious: ${result.malicious}`);
          log(`[+] Threats: ${result.threats.length} | Blacklists: ${result.blacklists.filter((b: any) => b.listed).length}`);
        }
        break;
      }
      case "breach": {
        const { fullBreachCheck } = await import("./breach-check.js");
        log(`[*] Breach check: ${target.includes("@") ? target : "****"}`);
        result = await fullBreachCheck(target);
        if (!isJson) {
          log(`[+] Breached: ${result.breached}`);
          if (result.pwnedCount) log(`[+] Found in ${result.pwnedCount.toLocaleString()} datasets`);
          if (result.passwordStrength) log(`[+] Strength: ${result.passwordStrength.score} (${result.passwordStrength.entropy} bits)`);
        }
        break;
      }
      case "nl": {
        const nlQuery = args.slice(1).join(" ");
        const { parseNaturalLanguage } = await import("./nl-investigator.js");
        log(`[*] Parsing: "${nlQuery}"`);
        result = parseNaturalLanguage(nlQuery);
        if (!isJson) {
          log(`[+] Targets: ${result.targets.join(", ")}`);
          log(`[+] Steps: ${result.suggestedChain.steps.map((s: any) => s.type).join(" → ")}`);
          log(`[+] Confidence: ${(result.confidence * 100).toFixed(0)}%`);
        }
        break;
      }
      default:
        console.error(`Unknown command: ${command}. Run with --help for usage.`);
        process.exit(1);
    }

    if (isJson) {
      console.log(JSON.stringify(result, null, 2));
    }

    log(`\n[*] Completed in ${((Date.now() - start) / 1000).toFixed(1)}s`);
  } catch (err) {
    console.error(`[!] Error: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

main();
