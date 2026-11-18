---
version: alpha
name: Food N Bev N Beyond Inbox
description: A private restaurant Messenger inbox using the existing hospitality dashboard identity
colors:
  primary: "#e46f58"
  background: "#f7f8f7"
  foreground: "#203039"
  card: "#ffffff"
  sidebar: "#1f3038"
  border: "#dfe7e5"
  outgoing: "#497e83"
  actionText: "#152126"
typography:
  sans:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    lineHeight: "1.5"
rounded:
  DEFAULT: "8px"
  bubble: "13px"
spacing:
  sidebar: "286px"
  topbar: "94px"
components:
  business-badge:
    textColor: "{colors.foreground}"
  send-button:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.actionText}"
---

# Food N Bev N Beyond Inbox Design

## Overview

This product serves FNBnB restaurant operators in El Nido. Its primary task is reading a guest message and replying as the restaurant the guest contacted. The existing shell, restaurant logos, dark sidebar and colored restaurant labels establish the visual identity. This feature extends that shell into an operational inbox.

English is the interface language. Dates and times use `en-PH` and `Asia/Manila`. Guest text may contain any language and is displayed verbatim as plain text. The restaurant logo and name are the recurring signature. Conversation lists and chat headers show the full restaurant Page name beside its logo, wrapping onto additional lines instead of clipping. Messenger-provided customer names and their initials identify senders; unavailable names use the truthful label ?Messenger user? without displaying numeric identifiers. Task controls remain quiet and familiar.

## Colors

The canonical token owner is `app/globals.css`. This file mirrors its accepted values. `--primary`, `--background`, `--foreground`, `--card` and `--border` flow through the existing Tailwind `@theme inline` adapter and direct CSS consumers. The sidebar uses `--ink`. Outgoing messages use the existing teal surface. Restaurant color classes accompany logos and written labels, so color never carries the Page identity alone. The `.messaging-app.dark` scope remaps surface and foreground tokens.

## Typography

The existing Inter/system stack is used for headings, conversation previews and controls. Headings use weight and size for hierarchy. Dates are explicitly labeled in Philippine time. Long guest text wraps within the message bubble. Email identities wrap in the operator profile.

## Layout

Desktop has restaurant navigation, a conversation list and a selected conversation. The conversation list and message body own their scroll areas. At 900px and below, the app shows one list or thread at a time. Restaurant navigation is a non-modal disclosure with Escape dismissal and focus restoration. The app uses dynamic viewport height to account for mobile browser controls. Authentication forms retain natural document scrolling.

## Elevation & Depth

Borders divide operational panels. The sign-in surface uses a restrained downward shadow. Persistent status appears in the owning panel and participates in layout. Critical feedback remains until its condition clears.

## Shapes

Controls use the existing 8–9px corner radius. Message bubbles retain 13px corners and direction-specific corner treatment. Small restaurant labels and avatars retain their established geometry.

## Components

`components/inbox.tsx` owns the inbox, restaurant filter, search, conversation view and composer. `components/login-form.tsx` owns password authentication and in-tab session recovery. Both use native form controls, visible labels, disabled/busy states and inline status feedback. Search has a keyboard-accessible clear button. Only data confirmed by the backend is shown as sent.

The global stylesheet owns scrollbar thumb, track, hover, active and forced-color behavior. Reduced-motion preferences disable transitions. Theme preference is the only browser-local persistence. The reply draft stays in memory for the open tab.

## Do's and Don'ts

Use the restaurant Page name from the integration allowlist. Show truthful empty, loading, disconnected and delivery states. Preserve guest text and drafts through recoverable failures. Avoid invented customer names, counts, successful delivery claims or operational status. Maintain the existing restaurant branding as new features are added.
