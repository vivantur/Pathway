/**
 * Canonical external links used throughout the site.
 *
 * Centralized so a URL change is a one-line edit. Public-only — these end up
 * in static markup, so never put secrets here.
 */

export const links = {
  /** "Add the Pathway bot to your Discord server" — installs the bot with the
   *  configured permissions. Sourced from Discord's OAuth2 URL generator. */
  addBotToServer:
    'https://discord.com/oauth2/authorize?client_id=1484284107688116294&permissions=8&scope=bot+applications.commands',
  /** Public community Discord invite. */
  communityDiscord: 'https://discord.gg/U77jRbEbqB' as string | null,
  /** Source repository for the website. */
  github: 'https://github.com/vivantur/pathway-website',
  /** Primary support / contact email. */
  contactEmail: 'mailto:hello@pathwaypf2e.com',
} as const;
