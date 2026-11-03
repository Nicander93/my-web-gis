export type HelpDialogPage = 'help' | 'about'

let openDialog: ((page: HelpDialogPage) => void) | null = null

export function registerHelpDialog(callback: typeof openDialog): void {
  openDialog = callback
}

export const helpCommands = {
  openHelp(): void {
    openDialog?.('help')
  },
  openAbout(): void {
    openDialog?.('about')
  }
}
