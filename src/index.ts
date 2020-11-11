import {createServer, RequestListener} from 'http'
import {config} from 'dotenv'
import {walk} from 'walk'
import {relative, join} from 'path'
import {readFileSync, existsSync} from "fs";
import {MongoClient} from 'mongodb'

config();
process.nextTick(async () => {
    let db = undefined;
    if (process.env.MONGO) {
        db = await MongoClient.connect(process.env.MONGO)
    }
    let functions = new Map<string, RequestListener>();
    await reload();

    createServer(async (req, res) => {
            const url = new URL(req.url, "http://0.0.0.0/");
            const key = url.pathname.substr(1);
            let fn = functions.get(key);
            try {
                if (fn) {
                    return fn.call({db: db, req: req, res: res});
                } else {
                    if (existsSync(join(process.env.FUNCTION_DIR, url.pathname + ".js"))) {
                        const fnStr = readFileSync(join(process.env.FUNCTION_DIR, url.pathname + ".js"), {encoding: "utf8"});
                        const fn = new Function('req', 'res', fnStr) as RequestListener;
                        functions.set(key, fn);
                        return fn.call({db: db, req: req, res: res});
                    } else {
                        res.writeHead(404, {'Content-Type': 'text/plain'});
                        res.end('No Found!\n');
                    }
                }
            } catch (e) {
                console.log(e)
                res.writeHead(500, {'Content-Type': 'text/plain'});
                res.end('Error!\n');
            }
        }
    ).listen(+process.env.PORT, "0.0.0.0", null)

    console.log(`Server running at http://0.0.0.0:${process.env.PORT}/`);
    setInterval(async () => {
        await reload();
    }, 1000 * 60 * 10)

    async function reload() {
        const ret = new Map<string, RequestListener>();
        const walker = walk(process.env.FUNCTION_DIR)
        walker.on("file", function (root, fileStats, next) {
            const fullPath = join(root, fileStats.name);
            const path = relative(process.env.FUNCTION_DIR, fullPath)
            if (path.endsWith('js')) {
                try {
                    const fnStr = readFileSync(join(process.env.FUNCTION_DIR, path), {encoding: "utf8"});
                    ret.set(path.substr(0, path.length - 3), new Function('req', 'res', fnStr) as RequestListener)
                } catch (e) {
                    console.log(`load function ${path} failed!`)
                }
            }
            next();
        });

        walker.on("errors", function (root, nodeStatsArray, next) {
            next();
        });

        walker.on("end", function () {
            functions = ret;
            console.log("All function reload!");
        });
    }

})
