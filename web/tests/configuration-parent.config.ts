import { defineConfig } from '@playwright/test'
import normal from '../playwright.config'
// Launch-only wrapper: identical normal discovery, no historical demo launcher.
// The selected adapter owns its protected fixture and permanent transport.
export default defineConfig({ ...normal, testDir: '.', webServer: undefined })
