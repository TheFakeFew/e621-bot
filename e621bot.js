const fetch = require('node-fetch');
const discord = require("discord.js");
const fs = require("fs");
const { resolve } = require('path');

const client = new discord.Client({
    intents: Object.keys(discord.GatewayIntentBits).map((bit) => {
        return discord.GatewayIntentBits[bit];
    })
});

const config = JSON.parse(fs.readFileSync(__dirname+"/config.json"));
const alreadyfetched = JSON.parse(fs.readFileSync(__dirname+"/fetched.json"));

async function sleep(ms){return new Promise((resolve) => setTimeout(resolve, ms))};

async function saveconfig(){fs.writeFileSync(__dirname+"/config.json", JSON.stringify(config, null, 2))};
async function savefetched(){fs.writeFileSync(__dirname+"/fetched.json", JSON.stringify(alreadyfetched))};

function clearObject(obj){for (var member in obj) delete obj[member]};
function clearArray(arr){arr.length = 0};

async function checkTags(tagsArray){
    var wasWhitelisted = false;
    var wasBlacklisted = false;
    if(!config.whitelist[0]) wasWhitelisted = true;

    for(var array in tagsArray){
        array = tagsArray[array];
        if(typeof(array) == "object"){
            for(var index = 0; index < array.length; index++){
                try{
                    const tag = array[index].toString();
                    if(config.whitelist.includes(tag.toLowerCase())) wasWhitelisted = true;
                    if(config.blacklist.includes(tag.toLowerCase())) wasBlacklisted = true;
                }catch(err){
                    if(config.debugmode) console.warn(err);
                };
            };
        };
    };
    return wasWhitelisted && !wasBlacklisted;
};

const headers = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Safari/537.36"
};

if(config.apiKey && config.apiKey.length > 1 && config.accountName && config.accountName.length > 1){
    headers["Authorization"] = "Basic " + btoa(`${config.accountName}:${config.apiKey}`);
};

function Random(max) {
    return Math.round(Math.random() * max);
};

async function getPost(tags, page){
    var posts = await fetch(`https://e621.net/posts.json${tags && `?tags=${tags}&` || '?'}limit=320&page=${page && page || Random(config.PagesToSearch)}`, {
       headers: headers
    }).then(response => response.json()).then(json => json.posts);

    if (!posts || !posts[0]) {
        posts = null;
        console.warn(`no posts on tags: ${tags} page: ${page}`);
        return;
    };

    var resolvepromise;
    const promise = new Promise((resolve) => {
        resolvepromise = resolve;
    });

    var checked = 0;
    var indexes = [];

    async function attempt(){
        var index = Random(posts.length);

        let post = posts[index];
        checked++

        if(checked > posts.length){
            if(post) clearObject(post);
            post = null;

            clearArray(posts);
            posts = null;

            clearArray(indexes);
            indexes = null;

            console.log("advancing to new page");
            await sleep(1000);
            resolvepromise(await getPost(tags, page));
            return;
        };

        if(indexes.includes(index)){
            index = null;
            return await attempt();
        };
        indexes.push(index);

        if (!post) {
            post = null;
            return;
        };
        if (!post.file || !post.file.url) {
            clearObject(post);
            post = null;
            
            return await attempt();
        };

        const allowed = (await checkTags(post.tags) || (tags && (tags.includes(`fav:${config.accountName}`) && true))) && post.rating == config.allowedrating;
        if(!allowed){
            clearObject(post);
            post = null;
            return await attempt();
        };

        if(alreadyfetched.includes(post.id)){
            clearObject(post);
            post = null;
            
            return await attempt();
        };

        if(!post.tags.character[0]) post.tags.character.push("unknown_character");
        if(!post.tags.artist[0]) post.tags.artist.push("anonymous_artist");

        var url = post.file.url;
        var name = `${post.tags.character.join(", ")} by ${post.tags.artist.join(", ")}`;

        alreadyfetched.push(post.id);
        savefetched();

        clearObject(post);
        post = null;

        clearArray(posts);
        posts = null;

        clearArray(indexes);
        indexes = null;

        attempt = null;


        console.log(name, url);

        resolvepromise({
            "url": url,
            "name": name
        });
    };

    attempt();

    return promise;
};

client.on("ready", async () => {
    console.log(`logged into ${client.user.tag}`);
    const user = await client.users.fetch(config.discordId);
    const dm = await user.createDM();

    setInterval(async () => {
        try{
            var post = await getPost().catch(console.warn);
            if(!post) return;
            dm.send(`[${post.name}](${post.url}) ||\n||`).catch(console.warn);
        } catch(err) {
            console.warn(err);
        };
    }, config.CycleTime);
});

const commands = {
    "ping": async function(message, args){
        const timestamp = Date.now();
        message.send("check").then((msg) => {
            msg.delete();
            message.reply(`${Date.now() - timestamp}ms`);
        });
    },

    "blacklist": async function(message, args){
        for(var i = 0; i < args.length; i++){
            const tag = args[i];

            const index = config.whitelist.indexOf(tag);
            if(index !== -1) config.whitelist.splice(index, 1);

            config.blacklist.push(tag);
        };
        saveconfig();

        message.reply("done");
    },
    "whitelist": async function(message, args){
        for(var i = 0; i < args.length; i++){
            const tag = args[i];

            const index = config.blacklist.indexOf(tag);
            if(index !== -1) config.blacklist.splice(index, 1);

            config.whitelist.push(tag);
        };
        saveconfig();

        message.reply("done");
    },

    "removeblacklist": async function(message, args){
        for(var i = 0; i < args.length; i++){
            const tag = args[i];

            const index = config.blacklist.indexOf(tag);
            if(index !== -1) config.blacklist.splice(index, 1);
        };
        saveconfig();

        message.reply("done");
    },
    "removewhitelist": async function(message, args){
        for(var i = 0; i < args.length; i++){
            const tag = args[i];

            const index = config.whitelist.indexOf(tag);
            if(index !== -1) config.whitelist.splice(index, 1);
        };
        saveconfig();

        message.reply("done");
    },

    "setrating": async function(message, args){
        const rating = args[0];
        config.allowedrating = rating;
        saveconfig();

        message.reply("done");
    },
    "setpages": async function(message, args){
        const pages = Number(args[0]);
        config.PagesToSearch = pages;
        saveconfig();

        message.reply("done");
    },
    "setcycle": async function(message, args){
        const pages = Number(args[0]);
        config.CycleTime = pages;
        saveconfig();

        message.reply("done");
    },

    "commands": async function(message, args){
        const cmds = [];
        for(command in commands) cmds.push(command);
        message.reply(cmds.join(", "));
    },

    "viewblacklist": async function(message, args){
        message.reply(config.blacklist.join(", "));
    },
    "viewwhitelist": async function(message, args){
        message.reply(config.whitelist.join(", "));
    },
};

client.on("messageCreate", async (message) => {
    if(message.system || message.author.bot || message.author.guild || !message.content.startsWith("!")) return;

    const args = message.content.split(" ");
    if(!args[0]) return;
    const command = args[0].substring(1);
    args.splice(0, 1);

    const func = commands[command.toLowerCase()];
    if(func) func(message, args).catch((err) => {
        message.reply(err.toString())
    });
});

client.login(config.botToken);