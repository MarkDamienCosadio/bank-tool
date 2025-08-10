import { chromium, type Page } from 'playwright';

// =================================================================
// HELPER FUNCTION DEFINITIONS
// =================================================================

/**
 * Parses the bank name from command-line arguments.
 * @returns The bank name as a string.
 * @throws {Error} if the bank name argument is missing or invalid.
 */
function getBankNameFromArgs(): string {
  const bankNameArg = process.argv.find(arg => arg.startsWith('--bank='));
  
  if (bankNameArg && bankNameArg.split('=').length > 1) {
    const value = bankNameArg.split('=')[1];
    if (value) {
      return value;
    }
  }

  throw new Error('Please provide a valid bank name. Usage: node --loader ts-node/esm src/scrape.ts --bank="Your Bank Name"');
}


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
  console.log('Modal container detected.');
  
  const continueButton = modal.locator('#continue-navigation');
  
  const [newPage] = await Promise.all([
    page.context().waitForEvent('page'),
    continueButton.click()
  ]);

  await newPage.waitForLoadState();
  
  console.log('Captured new tab and navigated to bank website.');
  return newPage.url();
}

async function analyzeBankWebsiteForOffers(page: Page, bankUrl: string): Promise<{ hasOffer: boolean, sourceUrl: string }> {
  console.log(`(2/2) Analyzing bank website: ${bankUrl}`);
  
  await page.goto(bankUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
  console.log('   - Page loaded. Looking for cookie banner...');

  try {
    await page.getByRole('button', { name: /Accept|Allow all|Accept all/i }).click({ timeout: 5000 });
    console.log('   - Cookie banner accepted.');
  } catch (e) {
    console.log('   - No cookie banner found, or it was not clickable.');
  }

  try {
    await page.getByRole('link', { name: /Business|Small Business|For Business/i }).first().click({ timeout: 5000 });
    console.log('   - Navigated to Business section.');
    await page.getByRole('link', { name: /Credit Card/i }).first().click({ timeout: 5000 });
    console.log('   - Navigated to Credit Cards section.');
  } catch (e) {
    console.log('   - Could not navigate to a specific credit card section, analyzing current page.');
  }

  const finalUrl = page.url();
  console.log(`   - Analyzing content on: ${finalUrl}`);

  const cardSectionSelector = 'div[class*="card"], section[class*="offer"]';
  try {
    console.log('   - Waiting for offer sections to load...');
    await page.locator(cardSectionSelector).first().waitFor({ timeout: 10000 });
    console.log('   - Offer sections are loaded.');
  } catch(e) {
    console.warn('   - Timed out waiting for card sections to appear.');
    return { hasOffer: false, sourceUrl: finalUrl };
  }

  const cardSections = await page.locator(cardSectionSelector).all();
  console.log(`   - Found ${cardSections.length} potential card sections. Analyzing each...`);

  const businessRegex = /business/i;
  const offerRegex = /(0%|zero percent)\s+(introductory\s+)?(apr|interest)/i;

  for (const [index, section] of cardSections.entries()) {
    const sectionText = await section.innerText();
    const isBusinessCard = businessRegex.test(sectionText);
    const hasOffer = offerRegex.test(sectionText);
    
    if (isBusinessCard && hasOffer) {
      console.log('   - SUCCESS: Found a business card section with a 0% offer.');
      return { hasOffer: true, sourceUrl: finalUrl };
    }
  }
  
  console.log('   - No specific business card with the 0% offer was found.');
  return { hasOffer: false, sourceUrl: finalUrl };
}

// =================================================================
// MAIN EXECUTION
// =================================================================

console.log('Scraper starting...');

const browser = await chromium.launch({ headless: false });

try {
  const bankName = getBankNameFromArgs(); 
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  });
  
  const fdicPage = await context.newPage();
  const officialWebsite = await findBankWebsiteOnFDIC(fdicPage, bankName);
  
  if (officialWebsite) {
    console.log(`FDIC Task Complete! Found official website: ${officialWebsite}`);
    
    const bankPage = await context.newPage();
    const analysis = await analyzeBankWebsiteForOffers(bankPage, officialWebsite);

    if (analysis.hasOffer) {
      console.log(`\n SUCCESS! Potential 0% APR Business Credit Card offer found!`);
      console.log(`   - Source: ${analysis.sourceUrl}`);
    } else {
      console.log(`\n No explicit 0% APR Business Credit Card offer was found.`);
    }

  } else {
    console.warn(`Could not find a website for "${bankName}" on the FDIC site.`);
  }

} catch (error) {
  console.error(`${error instanceof Error ? error.message : 'An unknown error occurred'}`);
} finally {
  await browser.close();
  console.log('Browser closed. Scraper finished.');
}