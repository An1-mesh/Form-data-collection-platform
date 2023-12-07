import express, { Request, Response } from "express";
import mongoose, { Types } from "mongoose";
import cookieParser from "cookie-parser";

import authRouter from "./util/auth";
import { appendLogs, clearLogs, findLogById, getLogsAfterTimestamp } from "./util/logManager";
import { formulateAndValidateFormData } from "./util/validation";

import {
    PORT,
    MONGO_URI,
    MONGO_USERNAME,
    MONGO_PASSWORD,
    MONGO_DB,
} from "./config";
import Submission, { FormData } from "./schema/submission";
import Form, { IForm } from "./schema/schema";
import { executePlugins } from "./util/pluginExection";

const app = express();

console.log("[NOTE]: Connecting to MONGO DB:", MONGO_URI);
mongoose.connect(MONGO_URI, {
        user: MONGO_USERNAME,
        pass: MONGO_PASSWORD,
        dbName: MONGO_DB,
    }).then(() => {
        console.log("[NOTE]: Connected to MONGO DB.");
    }).catch((err) => {
        appendLogs("MONGODB_CONNECTION_FAILURE", `Connection to MONGO DB: ${MONGO_URI} failed`);
        console.error(
            "[ERROR]: Could not connect to Mongo Server:", err.reason
        );
    });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use("/api/auth", authRouter);

app.post("/api/submit", async (req: Request, res: Response) => {
    if (!req.body || !req.body.formId || !req.body.form) {
        return res
            .status(400)
            .json({ success: false, message: "Body and/or FormID missing." });
    }

    const { form, formId } = req.body;

    let parsedBody: FormData = {};
    let formSchema: IForm | null = null;
    try {
        const doc = await Form.findById(formId);
        if (!doc) {
            appendLogs("FORM_FIND_FAILURE", `Could not find form(${MONGO_URI})`);
            throw "[ERROR]: Invalid Form ID found.";
        }
        formSchema = doc.toJSON();
        if (!formSchema) {
            appendLogs("FORM_FIND_FAILURE", `Could not find form(${MONGO_URI})`);
            throw "[ERROR]: Invalid Form ID found.";
        }
        parsedBody = formulateAndValidateFormData(form, formSchema);
    } catch (err) {
        console.error(err);
        appendLogs("FORM_SUBMISSION_FAILURE", `Could not submit form response: ${MONGO_URI}`);
        return res.status(400).json({
            success: false,
            message: `Invalid submission. ERROR: ${err}`,
        });
    }

    // TODO: Fire event here before submission.
    const pluginOut = await executePlugins(
        parsedBody,
        formSchema,
        formSchema.plugins
    );

    if (pluginOut.error) {
        appendLogs("FORM_CONNECTION_FAILURE", `Could not connect to plugin: ${pluginOut.message}`);
        return res.status(401).json({
            success: false,
            message: `Plugin reject: ${pluginOut.message}`,
        });
    }

    const submission = new Submission({
        schemaId: formId,
        id: new Types.ObjectId(),
        formData: parsedBody,
    });

    try {
        await submission.save();
    } catch (err) {
        console.error(err);
        appendLogs("SERVER_SAVE_FAILURE", `Could not save submission(${submission.id})`);
        return res.status(500).json({
            success: false,
            message: "Server error, could not save document.",
        });
    }

    return res
        .status(200)
        .json({ success: true, message: "Submitted form.", body: parsedBody });
});

app.get("/api/form/:formId", async (req: Request, res: Response) => {
    try {
        const formId = req.params.formId;

        const form = await Form.findById(formId);

        if (!form) {
            return res
                .status(404)
                .json({ success: false, message: "Form not found." });
        }

        const d = new Date();
        if (d < form.openingTime || form.closingTime < d) {
            return res.status(404).json({
                success: false,
                message:
                    "Form has either not opened or has closed. Contact operator.",
            });
        }

        res.status(200).json({ success: true, form });
    } catch (error) {
        // Handle errors
        console.error(error);
        appendLogs("INTERNAL_SERVER_FAILURE", ".");
        res.status(500).json({
            success: false,
            message: "Internal Server Error",
        });
    }
});

app.listen(PORT, () => {
    console.log("[NOTE]: Server listening on PORT:", PORT);
});
