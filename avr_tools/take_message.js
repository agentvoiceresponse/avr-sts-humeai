require("dotenv").config();
const { init, tx } = require('@instantdb/admin');

const db = init({
  appId: process.env.INSTANTDB_APPID,
  adminToken: process.env.INSTANTDB_SECRET
});

// Helper functions
function generateSummary(content, maxLength = 100) {
  if (content.length <= maxLength) return null;
  const firstSentence = content.match(/^[^.!?]+[.!?]/);
  if (firstSentence && firstSentence[0].length <= maxLength) {
    return firstSentence[0];
  }
  return content.substring(0, maxLength).trim() + '...';
}

function generateSubject(content, category, fromName) {
  const preview = content.substring(0, 50).trim();
  if (category === 'voicemail' && fromName) {
    return `Voicemail from ${fromName}`;
  }
  const categoryLabels = {
    callback: 'Callback Request',
    todo: 'Action Item',
    important: 'Important Message',
    reminder: 'Reminder',
    note: 'Note',
    inquiry: 'Inquiry'
  };
  return categoryLabels[category] || preview;
}

module.exports = {
  name: "take_message",
  description: "Records a message, voicemail, or note for the user. Use this when someone wants to leave a message, when the user wants to save a note for themselves, or when recording important information from a conversation. Automatically detects if callback is needed and extracts contact information.",
  input_schema: {
    type: "object",
    properties: {
      profile_id: {
        type: "string",
        description: "Unique identifier for the profile receiving the message"
      },
      organization_id: {
        type: ["string", "null"],
        description: "Organization ID if this is an organizational message (optional)"
      },
      chat_id: {
        type: ["string", "null"],
        description: "Chat ID if this message originated from a chat (optional)"
      },
      content: {
        type: "string",
        description: "The full message content or note text"
      },
      subject: {
        type: ["string", "null"],
        description: "Brief subject line or title for the message (optional, auto-generated if not provided)"
      },
      from_name: {
        type: ["string", "null"],
        description: "Name of the person leaving the message (if applicable)"
      },
      from_phone: {
        type: ["string", "null"],
        description: "Phone number of the person leaving the message (if provided)"
      },
      from_email: {
        type: ["string", "null"],
        description: "Email of the person leaving the message (if provided)"
      },
      category: {
        type: "string",
        enum: ["voicemail", "note", "reminder", "todo", "important", "callback", "inquiry"],
        description: "Type of message"
      },
      priority: {
        type: "string",
        enum: ["low", "medium", "high", "urgent"],
        description: "Priority level"
      },
      requires_callback: {
        type: "boolean",
        description: "Whether the caller/sender is requesting a callback or response"
      },
      callback_number: {
        type: ["string", "null"],
        description: "Phone number to call back if different from from_phone (optional)"
      },
      due_date: {
        type: ["string", "null"],
        description: "Due date for action items in ISO format YYYY-MM-DD (optional)"
      },
      tags: {
        type: ["string", "null"],
        description: "Comma-separated tags for categorization (optional)"
      },
      sentiment: {
        type: ["string", "null"],
        enum: ["positive", "neutral", "negative", "urgent", null],
        description: "Detected emotional tone of the message (optional)"
      }
    },
    required: ["profile_id", "content", "category", "priority", "requires_callback"]
  },
  handler: async (uuid, args) => {
    try {
      const {
        profile_id,
        organization_id = null,
        chat_id = null,
        content,
        subject = null,
        from_name = null,
        from_phone = null,
        from_email = null,
        category,
        priority,
        requires_callback,
        callback_number = null,
        due_date = null,
        tags = null,
        sentiment = null
      } = args;

      const messageId = id();
      const now = Date.now();
      
      const messageSubject = subject || generateSubject(content, category, from_name);
      const aiSummary = generateSummary(content);
      const tagList = tags ? tags.split(',').map(t => t.trim()) : [];
      
      const messageData = {
        content: content,
        subject: messageSubject,
        fromName: from_name,
        fromPhone: from_phone,
        fromEmail: from_email,
        category: category,
        priority: priority,
        status: 'unread',
        requiresCallback: requires_callback,
        callbackNumber: callback_number || from_phone,
        dueDate: due_date,
        sentiment: sentiment,
        aiSummary: aiSummary,
        createdAt: now
      };
      
      const transactions = [
        tx.messages[messageId].update(messageData).link({ profile: profile_id })
      ];
      
      if (organization_id) {
        transactions.push(tx.messages[messageId].link({ organization: organization_id }));
      }
      
      if (chat_id) {
        transactions.push(tx.messages[messageId].link({ chat: chat_id }));
      }
      
      if (tagList.length > 0) {
        for (const tagName of tagList) {
          const tagId = id();
          transactions.push(
            tx.tags[tagId].update({
              name: tagName,
              createdAt: now
            }).link({ 
              profile: profile_id,
              ...(organization_id && { organization: organization_id })
            })
          );
          transactions.push(tx.messages[messageId].link({ tags: tagId }));
        }
      }
      
      await db.transact(transactions);
      
      return {
        success: true,
        message_id: messageId,
        message: `Message saved successfully${from_name ? ` from ${from_name}` : ''}${requires_callback ? ' - Callback requested' : ''}`,
        details: {
          subject: messageSubject,
          category: category,
          priority: priority,
          requires_callback: requires_callback
        }
      };
      
    } catch (error) {
      console.error('Error taking message:', error);
      return {
        success: false,
        message: `Failed to save message: ${error.message}`
      };
    }
  }
};