/** Use an installed browser when supplied; otherwise unpack the CI Chromium. */
export const browserExecutable = chromium => process.env.CHROME_EXECUTABLE_PATH || chromium.executablePath();
