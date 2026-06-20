/// <reference types="astro/client" />

/** Extend Astro.locals with our custom properties. */
declare namespace App {
  interface Locals {
    /** Whether the current visitor has a valid admin session cookie. */
    isAdmin: boolean;
    /** The raw Cookie header forwarded from the browser request (SSR only). */
    ssrCookie?: string;
  }
}