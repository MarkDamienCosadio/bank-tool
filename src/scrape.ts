import { chromium, type Page } from 'playwright';
import { factory } from 'typescript';

async function findBankWebsiteOnFDIC(page: Page, bankName: string): Promise<string | null> {
  console.log(`(1/2) Searching FDIC for "${bankName}"...`);
  
  await page.goto('https://banks.data.fdic.gov/bankfind-suite/bankfind', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('Enter Bank Name').fill(bankName);
  await page.locator('#findBankSearch').click();
  await page.locator('#search-result-card-0').waitFor();

  const resultLink = page.locator('#search-result-card-0 .primary-website a');
  
  const count = await resultLink.count();
  if (count === 0) {
    console.warn(`   - No link found in the first result for "${bankName}".`);
    return null;
  }
  
  await resultLink.click();

  const modal = page.locator('div[role="dialog"]');
  await modal.waitFor();
  console.log(' Modal container detected.');
  
  const continueButton = modal.locator('#continue-navigation');
  
  const [newPage] = await Promise.all([
    page.context().waitForEvent('page'),
    continueButton.click()
  ]);

  await newPage.waitForLoadState();
  
  console.log(' Captured new tab and navigated to bank website.');
  return newPage.url();
}

function getBankNameFromArgs(): string {
  console.log('Arguments received by script:', process.argv); 
  
  const bankNameArg = process.argv.find(arg => arg.startsWith('--bank='));
  
  if (bankNameArg && bankNameArg.split('=').length > 1) {
    const value = bankNameArg.split('=')[1];
    if (value) {
      return value;
    }
  }

  throw new Error('Please provide a valid bank name. Usage: npx ts-node src/scrape.ts --bank="Your Bank Name"');
}

console.log('Scraper starting...');

const browser = await chromium.launch({ headless: false });

try {
  const bankName = getBankNameFromArgs(); 
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  const officialWebsite = await findBankWebsiteOnFDIC(page, bankName);
  
  if (officialWebsite) {
    console.log(`Success! Found official website: ${officialWebsite}`);
  } else {
    console.warn(`Could not find a website for "${bankName}" on the FDIC site.`);
  }

} catch (error) {
  console.error(`${error instanceof Error ? error.message : 'An unknown error occurred'}`);
} finally {
  await browser.close();
  console.log('Browser closed. Scraper finished.');
}