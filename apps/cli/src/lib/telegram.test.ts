import { expect, test, describe } from "bun:test";
import { parseChannelPage } from "./telegram.ts";

// Trimmed from a real t.me/s/LinkUpAddis response (2026-08-19). Keeps the parts
// the parser depends on: the data-post id, the post's own photo, <br> line
// breaks, an encoded entity, a link, and the footer timestamp — plus the
// channel avatar, which must NOT be mistaken for the post's image.
const PAGE = `
<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="LinkUpAddis/12873">
  <div class="tgme_widget_message_user"><a href="https://t.me/LinkUpAddis"><i class="tgme_widget_message_user_photo" style="background-image:url('https://cdn4.telesco.pe/file/avatar.jpg')"></i></a></div>
  <a class="tgme_widget_message_photo_wrap" href="https://t.me/LinkUpAddis/12873" style="width:600px;background-image:url('https://cdn4.telesco.pe/file/flyer.jpg')"></a>
  <div class="tgme_widget_message_text js-message_text" dir="auto">Static returns to Anki Liquor.<br/><br/>Lock in you&#39;r ticket for 700ETB.<br/>Ticket link: <a href="https://afromile.com/x">https://afromile.com/x</a></div>
  <div class="tgme_widget_message_footer"><span class="tgme_widget_message_meta"><a class="tgme_widget_message_date" href="https://t.me/LinkUpAddis/12873"><time datetime="2026-08-17T06:57:26+00:00" class="time">06:57</time></a></span></div>
</div></div>
<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="LinkUpAddis/12874">
  <a class="tgme_widget_message_photo_wrap" href="https://t.me/LinkUpAddis/12874" style="background-image:url('https://cdn4.telesco.pe/file/other.jpg')"></a>
  <div class="tgme_widget_message_text js-message_text" dir="auto">​A second post.</div>
</div></div>
`;

describe("parseChannelPage", () => {
  test("reads every post on the page", () => {
    const posts = parseChannelPage(PAGE);
    expect(posts.map((post) => post.messageId)).toEqual([12873, 12874]);
    expect(posts[0]!.url).toBe("https://t.me/LinkUpAddis/12873");
  });

  test("keeps line breaks and decodes entities", () => {
    const [first] = parseChannelPage(PAGE);
    expect(first!.text).toBe(
      "Static returns to Anki Liquor.\n\nLock in you'r ticket for 700ETB.\nTicket link: https://afromile.com/x",
    );
  });

  // The avatar sits above the photo in document order, so a looser selector
  // would give every post the same image.
  test("takes the post's photo, not the channel avatar", () => {
    const [first] = parseChannelPage(PAGE);
    expect(first!.imageUrl).toBe("https://cdn4.telesco.pe/file/flyer.jpg");
  });

  test("reads the footer timestamp", () => {
    const [first] = parseChannelPage(PAGE);
    expect(first!.postedAt?.toISOString()).toBe("2026-08-17T06:57:26.000Z");
    expect(parseChannelPage(PAGE)[1]!.postedAt).toBeNull();
  });

  test("strips the channel's leading zero-width space", () => {
    expect(parseChannelPage(PAGE)[1]!.text).toBe("A second post.");
  });

  test("no posts in unrelated html", () => {
    expect(parseChannelPage("<html><body>nothing</body></html>")).toEqual([]);
  });
});
