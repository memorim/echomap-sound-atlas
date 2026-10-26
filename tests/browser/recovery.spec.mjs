import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{await page.route('https://tile.openstreetmap.org/**',route=>route.abort());});
test('mobile layout and recovery after a failed API request',async({page})=>{
 await page.goto('/');await expect(page.getByRole('heading',{level:1})).toBeVisible();await expect(page.locator('.load-feedback')).toHaveText('');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);
 await page.route('**/api/sounds*',r=>r.fulfill({status:503,contentType:'application/json',body:'{"message":"Test unavailable"}'}));
 await page.reload();await expect(page.getByRole('button',{name:'Повторить загрузку',exact:true})).toBeVisible();
 await page.unroute('**/api/sounds*');await page.getByRole('button',{name:'Повторить загрузку',exact:true}).click();
 await expect(page.locator('.load-feedback')).toHaveText('');
});

test('audio controls can stop, switch and play another recording',async({page})=>{const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await expect(page.locator('.load-feedback')).toHaveText('');await page.locator('.play').click();await expect(page.locator('.play')).toHaveText('■');await page.locator('.play').click();await page.locator('.next').click();await page.locator('.play').click();await expect(page.locator('.play')).toHaveText('■');await page.locator('.play').click();expect(errors).toEqual([]);});

test('unavailable recording is reported without breaking the catalog',async({page})=>{
 await page.route('**/audio/*.mp3',route=>route.abort());const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.locator('.sound-row')).toHaveCount(8);await page.locator('.play').click();await expect(page.locator('#audio-status')).toContainText('Не удалось');expect(errors).toEqual([]);
});
test('every recording has an existing photographic cover',async({page})=>{
 await page.goto('/');await expect(page.locator('.sound-row')).toHaveCount(8);
 for(let i=0;i<8;i++){await page.locator('.next').click();await expect.poll(()=>page.locator('#cover-photo').evaluate(img=>img.complete&&img.naturalWidth>0),{timeout:1000}).toBe(true);}
});

test('one audio element is reused and page exit releases its resource',async({page})=>{
 await page.addInitScript(()=>{const Native=window.Audio;window.audioCreated=0;window.Audio=function(...args){window.audioCreated++;return window.lastAudio=new Native(...args)}});
 await page.goto('/');await expect(page.locator('.sound-row')).toHaveCount(8);
 for(let i=0;i<3;i++){await page.locator('.play').click();await expect(page.locator('.play')).toHaveAttribute('aria-pressed','true');await page.locator('.play').click();await expect(page.locator('.play')).toHaveAttribute('aria-pressed','false');}
 expect(await page.evaluate(()=>audioCreated)).toBe(1);
 await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
 expect(await page.evaluate(()=>lastAudio.paused&&!lastAudio.hasAttribute('src'))).toBe(true);
});
test('a delayed play promise cannot revive the previous selection',async({page})=>{
 await page.addInitScript(()=>{const nativePlay=HTMLMediaElement.prototype.play;let held=false;HTMLMediaElement.prototype.play=function(){if(!held){held=true;return new Promise(resolve=>window.releaseAudio=resolve)}return nativePlay.call(this)}});
 await page.goto('/');await expect(page.locator('.sound-row')).toHaveCount(8);await page.locator('.play').click();await expect(page.locator('.play')).toHaveText('…');await page.locator('.next').click();await page.evaluate(()=>window.releaseAudio());await expect(page.locator('.play')).toHaveAttribute('aria-pressed','false');
 await page.locator('.play').click();await expect(page.locator('.play')).toHaveAttribute('aria-pressed','true');await page.locator('.play').click();
});
test('geographic marker chooses its recording',async({page})=>{
 await page.goto('/');await expect(page.locator('.location-pin')).toHaveCount(8);
 const marker=page.locator('.location-pin').nth(1);const title=await marker.getAttribute('title');await marker.focus();await marker.press('Enter');await expect(page.locator('#title')).toHaveText(title);await expect(marker).toBeFocused();
 await expect(page.locator('#recording-source')).toHaveAttribute('href',/^https:\/\/freesound.org\//);
});
test('empty selection disables navigation and playback',async({page})=>{
 await page.route('**/api/sounds*',r=>r.fulfill({contentType:'application/json',body:'[]'}));await page.goto('/');await expect(page.locator('#title')).toHaveText('Нет записей');for(const selector of ['.play','.previous','.next'])await expect(page.locator(selector)).toBeDisabled();
});

test('keyboard selection retains focus on its recording control',async({page})=>{
 await page.goto('/');const button=page.locator('.sound-row button').first();await button.focus();await page.keyboard.press('Enter');await expect(button).toBeFocused();await expect(page.locator('.play')).toHaveAttribute('aria-pressed','true');await page.locator('.play').click();
});
