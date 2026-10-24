import {test,expect} from '@playwright/test';
test('mobile layout and recovery after a failed API request',async({page})=>{
 await page.goto('/');await expect(page.getByRole('heading',{level:1})).toBeVisible();await expect(page.locator('.load-feedback')).toHaveText('');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);
 await page.route('**/api/sounds*',r=>r.fulfill({status:503,contentType:'application/json',body:'{"message":"Test unavailable"}'}));
 await page.reload();await expect(page.getByRole('button',{name:'Повторить загрузку',exact:true})).toBeVisible();
 await page.unroute('**/api/sounds*');await page.getByRole('button',{name:'Повторить загрузку',exact:true}).click();
 await expect(page.locator('.load-feedback')).toHaveText('');
});

test('audio controls can stop, switch and play another recording',async({page})=>{const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await expect(page.locator('.load-feedback')).toHaveText('');await page.locator('.play').click();await expect(page.locator('.play')).toHaveText('■');await page.locator('.play').click();await page.locator('.next').click();await page.locator('.play').click();await expect(page.locator('.play')).toHaveText('■');await page.locator('.play').click();expect(errors).toEqual([]);});
