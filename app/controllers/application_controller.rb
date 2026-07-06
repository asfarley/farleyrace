class ApplicationController < ActionController::Base
  # No allow_browser gate: the game needs WebGL, import maps and pointer
  # events, which reach back to Safari 15 / older Android — much further than
  # Rails' :modern preset allows.

  # Changes to the importmap will invalidate the etag for HTML responses
  stale_when_importmap_changes
end
