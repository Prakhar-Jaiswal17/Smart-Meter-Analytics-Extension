# Smart Meter Analytics (Chrome Extension)

A Manifest V3 Chrome extension that enhances the CORE smart-meter portal (`core.polarisgrids.com`) with detailed electricity-consumption analytics, insights, and charts.

## Features

- **Privacy First:** Data is sourced directly from your active session on the portal. Your login credentials are not stored or transmitted anywhere except to the official CORE API.
- **Detailed Analytics Dashboard:** View your daily consumption, daily costs, and power metrics in interactive charts.
- **Wallet Estimations:** Understand how long your current balance will last based on your average daily usage.
- **Power Monitoring:** Check your latest observed power draw (watts) and peak power of the day.
- **Insights:** Automated analysis on your consumption patterns.

## Installation Instructions

1. Clone or download this repository.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** using the toggle switch in the top right corner.
4. Click on the **Load unpacked** button in the top left corner.
5. Select the `SmartMeterExtension` directory.
6. The extension is now installed! You should see the Smart Meter Analytics icon in your browser toolbar.

## How to Use

1. Navigate to the [CORE smart-meter portal](https://core.polarisgrids.com) and log in to your account.
2. Once logged in, the extension will securely extract your session token in the background.
3. Click the extension icon in your Chrome toolbar to open the compact popup.
4. From the popup, click **Open Full Dashboard** to view detailed charts, historical records, and insights.

## Architecture

This extension strictly separates responsibilities to maintain high security:

- **Auth Bridge:** A minimal script extracts the session token from the portal's local storage and passes it to the Service Worker.
- **Service Worker:** Acts as a secure proxy. It stores the token in ephemeral session storage (cleared on browser close), handles all CORE API requests, and passes normalized data to the UI.
- **Dashboard / Popup:** Never handles or sees the authentication token. They only receive the final analytics data via Chrome messaging.

## Legal / Disclaimer

This extension is not affiliated with, endorsed by, or connected to Polaris Grids or the CORE smart meter platform. It operates entirely on the client-side as a custom UI wrapper over the user's authorized data.
