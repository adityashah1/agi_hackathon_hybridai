import "./styles.css";
import {
  SidebarInset,
  SidebarProvider,
} from "@repo/design-system/components/ui/sidebar";
import { Toaster } from "@repo/design-system/components/ui/sonner";
import { TooltipProvider } from "@repo/design-system/components/ui/tooltip";
import { fonts } from "@repo/design-system/lib/fonts";
import { ThemeProvider } from "@repo/design-system/providers/theme";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppSidebar } from "@/components/app-sidebar";

export const metadata: Metadata = {
  title: { default: "hybrid-gate panel", template: "%s · hybrid-gate" },
  description:
    "Where each agent step ran, why, and what it cost. Local vision model proposes, a gate decides, Sai takes the hard steps.",
};

interface RootLayoutProperties {
  readonly children: ReactNode;
}

const RootLayout = ({ children }: RootLayoutProperties) => (
  <html className={fonts} lang="en" suppressHydrationWarning>
    <body>
      <ThemeProvider>
        <TooltipProvider>
          <SidebarProvider>
            <AppSidebar />
            <SidebarInset>{children}</SidebarInset>
          </SidebarProvider>
        </TooltipProvider>
        <Toaster />
      </ThemeProvider>
    </body>
  </html>
);

export default RootLayout;
