require("dotenv").config();

const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const axios = require("axios");
const jwt = require("jsonwebtoken");

const app = express();
const PORT = process.env.PORT || 3000;

const KLING_ACCESS_KEY = process.env.KLING_ACCESS_KEY;
const KLING_SECRET_KEY = process.env.KLING_SECRET_KEY;
const KLING_BASE_URL =
    process.env.KLING_BASE_URL || "https://api-singapore.klingai.com";

const CREATE_TRYON_ENDPOINT = "/v1/images/kolors-virtual-try-on";
const DEFAULT_MODEL_NAME =
    process.env.KLING_MODEL_NAME || "kolors-virtual-try-on-v1";

app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
    dest: uploadDir,
    limits: {
        fileSize: 10 * 1024 * 1024
    }
});

function assertEnv() {
    if (!KLING_ACCESS_KEY || !KLING_SECRET_KEY) {
        throw new Error("В .env не найдены KLING_ACCESS_KEY и KLING_SECRET_KEY");
    }
}

function generateKlingJwt() {
    assertEnv();

    const now = Math.floor(Date.now() / 1000);

    return jwt.sign(
        {
            iss: KLING_ACCESS_KEY,
            exp: now + 60 * 30,
            nbf: now - 5
        },
        KLING_SECRET_KEY,
        {
            algorithm: "HS256",
            header: {
                alg: "HS256",
                typ: "JWT"
            }
        }
    );
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function toAbsoluteProjectPath(relativePath) {
    return path.join(__dirname, relativePath);
}

function fileExists(filePath) {
    return fs.existsSync(filePath);
}

async function removeFileSafe(filePath) {
    if (!filePath) return;
    try {
        await fsp.unlink(filePath);
    } catch (_) {}
}

function imageFileToRawBase64(filePath) {
    return fs.readFileSync(filePath).toString("base64");
}

function validateCloth(relativePath) {
    if (!relativePath) {
        throw new Error("Не выбрана одежда");
    }

    const absolutePath = toAbsoluteProjectPath(relativePath);

    if (!fileExists(absolutePath)) {
        throw new Error(`Файл одежды не найден: ${absolutePath}`);
    }

    return {
        relativePath,
        absolutePath,
        size: fs.statSync(absolutePath).size
    };
}

async function createTryOnTask({
    token,
    humanImageBase64,
    clothImageBase64,
    modelName = DEFAULT_MODEL_NAME
}) {
    const url = `${KLING_BASE_URL}${CREATE_TRYON_ENDPOINT}`;

    const requestBody = {
        model_name: modelName,
        human_image: humanImageBase64,
        cloth_image: clothImageBase64
    };

    const response = await axios.post(url, requestBody, {
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
        },
        timeout: 120000,
        maxBodyLength: Infinity
    });

    return response.data;
}

async function getTryOnTask({ token, taskId }) {
    const url = `${KLING_BASE_URL}${CREATE_TRYON_ENDPOINT}/${taskId}`;

    const response = await axios.get(url, {
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
        },
        timeout: 120000
    });

    return response.data;
}

async function pollTryOnResult({ token, taskId }) {
    const maxAttempts = 40;
    const delayMs = 3000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const taskData = await getTryOnTask({ token, taskId });

        console.log(`Polling attempt ${attempt}:`, {
            code: taskData?.code,
            message: taskData?.message,
            task_status: taskData?.data?.task_status,
            task_status_msg: taskData?.data?.task_status_msg || null
        });

        if (taskData?.code !== 0) {
            throw new Error(
                taskData?.message || "Kling вернул ошибку при запросе статуса задачи"
            );
        }

        const status = taskData?.data?.task_status;

        if (status === "succeed") {
            const imageUrl = taskData?.data?.task_result?.images?.[0]?.url;

            if (!imageUrl) {
                throw new Error("Задача завершилась успешно, но URL результата не найден");
            }

            return {
                taskId,
                imageUrl,
                raw: taskData
            };
        }

        if (status === "failed") {
            throw new Error(
                taskData?.data?.task_status_msg || "Kling try-on завершился с ошибкой"
            );
        }

        await sleep(delayMs);
    }

    throw new Error("Истекло время ожидания результата try-on");
}

async function callKlingTryOn({ userPhotoPath, clothPath }) {
    const token = generateKlingJwt();

    const humanImageBase64 = imageFileToRawBase64(userPhotoPath);
    const clothImageBase64 = imageFileToRawBase64(clothPath);

    console.log("Creating Kling try-on task...");

    const createData = await createTryOnTask({
        token,
        humanImageBase64,
        clothImageBase64
    });

    console.log("Create task response:", createData);

    if (createData?.code !== 0) {
        throw new Error(createData?.message || "Kling create task error");
    }

    const taskId = createData?.data?.task_id;
    if (!taskId) {
        throw new Error("Kling не вернул task_id");
    }

    return await pollTryOnResult({ token, taskId });
}

app.get("/api/health", (req, res) => {
    try {
        const token = generateKlingJwt();

        res.json({
            success: true,
            env: {
                hasAccessKey: Boolean(KLING_ACCESS_KEY),
                hasSecretKey: Boolean(KLING_SECRET_KEY),
                klingBaseUrl: KLING_BASE_URL,
                modelName: DEFAULT_MODEL_NAME
            },
            jwtPreview: {
                generated: Boolean(token),
                prefix: token.slice(0, 24) + "..."
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.post("/api/tryon", upload.single("userPhoto"), async (req, res) => {
    let uploadedUserPhotoPath = null;

    try {
        console.log("=== /api/tryon called ===");
        console.log("body:", req.body);
        console.log("file:", req.file);

        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: "Фото пользователя не получено"
            });
        }

        uploadedUserPhotoPath = req.file.path;

        const clothPath = req.body.clothPath;
        const clothName = req.body.clothName || "Cloth";
        const clothCategory = req.body.clothCategory || "unknown";

        const cloth = validateCloth(clothPath);

        console.log("selected cloth:", {
            clothName,
            clothCategory,
            relativePath: cloth.relativePath,
            absolutePath: cloth.absolutePath,
            size: cloth.size
        });

        const klingResult = await callKlingTryOn({
            userPhotoPath: uploadedUserPhotoPath,
            clothPath: cloth.absolutePath
        });

        return res.json({
            success: true,
            message: "Примерка успешно завершена",
            taskId: klingResult.taskId,
            resultImageUrl: klingResult.imageUrl
        });
    } catch (err) {
        console.error("SERVER ERROR FULL:", err?.response?.data || err);

        return res.status(500).json({
            success: false,
            error:
                err?.response?.data?.message ||
                err?.message ||
                "Неизвестная ошибка сервера"
        });
    } finally {
        await removeFileSafe(uploadedUserPhotoPath);
    }
});

app.listen(PORT, () => {
    console.log(`server running http://localhost:${PORT}`);
    console.log("ENV CHECK:", {
        hasAccessKey: Boolean(KLING_ACCESS_KEY),
        hasSecretKey: Boolean(KLING_SECRET_KEY),
        klingBaseUrl: KLING_BASE_URL,
        modelName: DEFAULT_MODEL_NAME
    });
});