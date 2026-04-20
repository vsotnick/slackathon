local usermanager = require "core.usermanager";
local sm = require "core.sessionmanager";
local json = require "util.json";
local b64 = require "util.encodings".base64;

module:depends("http");

local function check_auth(request)
    local auth_header = request.headers.authorization;
    if not auth_header then return false; end
    local method, b64_creds = auth_header:match("^([^ ]+) (.+)$");
    if method ~= "Basic" then return false; end
    local creds = b64.decode(b64_creds);
    if not creds then return false; end
    local jid, password = creds:match("^([^:]+):(.+)$");
    if not jid or not password then return false; end
    local username, host = jid:match("^([^@]+)@(.+)$");
    if not username then
        username = jid;
        host = module.host;
    end
    host = host:lower();
    
    if not prosody.hosts[host] then return false; end
    if not usermanager.test_password(username, host, password) then return false; end
    if not usermanager.is_admin(username .. "@" .. host, host) then return false; end
    return true;
end

local function send_json(response, status, data)
    response.headers.content_type = "application/json";
    response.status_code = status;
    return json.encode(data);
end

local function handle_user_post(event, path)
    local request, response = event.request, event.response;
    if not check_auth(request) then return send_json(response, 401, { error = "Unauthorized" }) end

    local username, target_host = path:match("^([^@]+)@(.+)$");
    if not username then
        username = path;
        target_host = request.headers.host:match("^([^:]+)"):lower();
    end

    if not username or username == "" then return send_json(response, 400, { error = "Missing username" }) end

    local data = json.decode(request.body);
    if not data or not data.password then return send_json(response, 400, { error = "Missing password" }) end

    local ok, err = usermanager.create_user(username, data.password, target_host);
    if ok then
        return send_json(response, 201, { message = "User created on " .. target_host });
    else
        return send_json(response, 500, { error = err });
    end
end

local function handle_user_delete(event, path)
    local request, response = event.request, event.response;
    if not check_auth(request) then return send_json(response, 401, { error = "Unauthorized" }) end

    local username, target_host = path:match("^([^@]+)@(.+)$");
    if not username then
        username = path;
        target_host = request.headers.host:match("^([^:]+)"):lower();
    end

    if not username or username == "" then return send_json(response, 400, { error = "Missing username" }) end

    local ok, err = usermanager.delete_user(username, target_host);
    if ok then
        return send_json(response, 200, { message = "User deleted from " .. target_host });
    else
        return send_json(response, 404, { error = "User not found or delete failed" });
    end
end

local function handle_password_put(event, path)
    local request, response = event.request, event.response;
    if not check_auth(request) then return send_json(response, 401, { error = "Unauthorized" }) end

    local username, target_host = path:match("^([^@]+)@(.+)$");
    if not username then
        username = path;
        target_host = request.headers.host:match("^([^:]+)"):lower();
    end

    if not username or username == "" then return send_json(response, 400, { error = "Missing username" }) end

    local data = json.decode(request.body);
    if not data or not data.password then return send_json(response, 400, { error = "Missing password" }) end

    local ok, err = usermanager.set_password(username, data.password, target_host);
    if ok then
        return send_json(response, 200, { message = "Password updated on " .. target_host });
    else
        return send_json(response, 500, { error = err });
    end
end

local function handle_kick_sessions(event, path)
    local request, response = event.request, event.response;
    if not check_auth(request) then return send_json(response, 401, { error = "Unauthorized" }) end

    local username, target_host = path:match("^([^@]+)@(.+)$");
    if not username then
        username = path;
        target_host = request.headers.host:match("^([^:]+)"):lower();
    end

    if not username or username == "" then return send_json(response, 400, { error = "Missing username" }) end

    local host_session = prosody.hosts[target_host];
    if not host_session or not host_session.sessions[username] then
        return send_json(response, 404, { message = "No active sessions on " .. target_host });
    end

    local sessions = host_session.sessions[username].sessions;
    local count = 0;
    for resource, session in pairs(sessions) do
        session:close({ condition = "policy-violation", text = "You have been disconnected by the server." });
        count = count + 1;
    end

    return send_json(response, 200, { message = "Kicked " .. count .. " sessions from " .. target_host });
end

local function handle_stats(event)
    local request, response = event.request, event.response;
    if not check_auth(request) then return send_json(response, 401, { error = "Unauthorized" }) end

    local c2s_count = 0;
    for host, host_session in pairs(prosody.hosts) do
        for username, user in pairs(host_session.sessions or {}) do
            for resource, session in pairs(user.sessions or {}) do
                c2s_count = c2s_count + 1;
            end
        end
    end

    return send_json(response, 200, { c2s_connections = c2s_count });
end

module:provides("http", {
    route = {
        ["POST /user/*"] = handle_user_post;
        ["DELETE /user/*/connected_resources"] = handle_kick_sessions;
        ["PUT /user/*/password"] = handle_password_put;
        ["DELETE /user/*"] = handle_user_delete;
        ["GET /stats"] = handle_stats;
    };
});
