export default async function handler(req, res) {
  // Allow only GET requests
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const { username } = req.query;

    if (!username) {
      return res.status(400).json({
        error: "Instagram username is required"
      });
    }

    // Remove @ if employee enters @username
    const cleanUsername = username.replace(/^@/, "").trim();

    if (!cleanUsername) {
      return res.status(400).json({
        error: "Invalid Instagram username"
      });
    }

    // These values will be stored in Vercel Environment Variables
    const ACCESS_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
    const IG_USER_ID = process.env.INSTAGRAM_USER_ID;

    // Keep Graph API version configurable
    const GRAPH_VERSION =
      process.env.META_GRAPH_VERSION || "v23.0";

    if (!ACCESS_TOKEN || !IG_USER_ID) {
      return res.status(500).json({
        error: "Instagram API is not configured on the server"
      });
    }

    /*
      Business Discovery request

      We ask Instagram for:
      - username
      - name
      - profile picture
      - followers
      - recent media
    */

    const fields = `
      business_discovery.username(${cleanUsername}) {
        username,
        name,
        profile_picture_url,
        followers_count,
        media.limit(25) {
          id,
          media_type,
          media_product_type,
          timestamp,
          permalink,
          caption,
          like_count,
          comments_count,
          views
        }
      }
    `.replace(/\s+/g, "");

    const url =
      `https://graph.facebook.com/${GRAPH_VERSION}/${IG_USER_ID}` +
      `?fields=${encodeURIComponent(fields)}` +
      `&access_token=${encodeURIComponent(ACCESS_TOKEN)}`;

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      console.error("Instagram API error:", data);

      return res.status(response.status).json({
        error: "Instagram API request failed",
        details: data
      });
    }

    const profile = data.business_discovery;

    if (!profile) {
      return res.status(404).json({
        error: "Instagram profile was not found or is not accessible"
      });
    }

    /*
      Find Reels.

      media_product_type can identify REELS.
      We also check media_type as a fallback.
    */

    const media = profile.media?.data || [];

    const reels = media.filter(item => {
      return (
        item.media_product_type === "REELS" ||
        item.media_type === "REELS"
      );
    });

    /*
      Calculate average Reel views.
    */

    const reelsWithViews = reels.filter(
      reel =>
        typeof reel.views === "number"
    );

    let averageReelViews = null;

    if (reelsWithViews.length > 0) {
      const totalViews = reelsWithViews.reduce(
        (total, reel) => total + reel.views,
        0
      );

      averageReelViews = Math.round(
        totalViews / reelsWithViews.length
      );
    }

    /*
      Find latest post.
    */

    const sortedMedia = [...media].sort(
      (a, b) =>
        new Date(b.timestamp) -
        new Date(a.timestamp)
    );

    const lastPost =
      sortedMedia.length > 0
        ? sortedMedia[0]
        : null;

    /*
      Return clean data to your frontend.
    */

    return res.status(200).json({
      success: true,

      profile: {
        instagram_username: profile.username,
        name: profile.name || null,
        instagram_user_id: IG_USER_ID,

        followers_count:
          profile.followers_count || 0,

        profile_picture_url:
          profile.profile_picture_url || null,

        last_post_date:
          lastPost?.timestamp || null,

        last_post_id:
          lastPost?.id || null,

        last_post_url:
          lastPost?.permalink || null
      },

      reels: reels.map(reel => ({
        id: reel.id,
        date: reel.timestamp,
        url: reel.permalink || null,
        views:
          typeof reel.views === "number"
            ? reel.views
            : null,
        likes:
          typeof reel.like_count === "number"
            ? reel.like_count
            : null,
        comments:
          typeof reel.comments_count === "number"
            ? reel.comments_count
            : null
      })),

      reel_count: reels.length,

      average_reel_views: averageReelViews
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "Internal server error",
      message: error.message
    });
  }
}
